import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { yCollab } from 'y-codemirror.next'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark as hljsTheme } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'github-markdown-css/github-markdown-light.css'
import './Editor.css'

const PERMISSION_LABELS = {
  private: { label: '🔒 私有', desc: '仅自己可访问' },
  custom: { label: '👥 自定义权限', desc: '为每个用户单独设置查看或编辑权限' }
}

export default function Editor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [viewMode, setViewMode] = useState('split')
  const [viewModeMenuOpen, setViewModeMenuOpen] = useState(false)
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [showImageUrlModal, setShowImageUrlModal] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [permission, setPermission] = useState('private')
  const [canEdit, setCanEdit] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const [invitedUsers, setInvitedUsers] = useState([])
  const [docInvitations, setDocInvitations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showInviteManagement, setShowInviteManagement] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [invitePermission, setInvitePermission] = useState('read')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [permissionChanged, setPermissionChanged] = useState(0)
  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const editorScrollRef = useRef(null)
  const viewRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const ydocRef = useRef(null)
  const providerRef = useRef(null)
  const contentRef = useRef('')
  const isScrolling = useRef(false)

  const insertMarkdown = (before, after = '', defaultText = '') => {
    const view = viewRef.current
    if (!view || !canEdit) return

    const { from, to } = view.state.selection.main
    const selectedText = view.state.sliceDoc(from, to) || defaultText

    view.dispatch({
      changes: { from, to, insert: before + selectedText + after },
      selection: { anchor: from + before.length, head: from + before.length + selectedText.length }
    })
    view.focus()
  }

  const insertLink = () => {
    const view = viewRef.current
    if (!view || !canEdit) return

    const { from, to } = view.state.selection.main
    const selectedText = view.state.sliceDoc(from, to) || '链接文字'

    view.dispatch({
      changes: { from, to, insert: `[${selectedText}](url)` },
      selection: { anchor: from + selectedText.length + 3, head: from + selectedText.length + 6 }
    })
    view.focus()
  }

  const insertImageFromUrl = () => {
    if (!imageUrlInput.trim()) return
    const view = viewRef.current
    if (!view || !canEdit) return

    const { from, to } = view.state.selection.main
    const selectedText = view.state.sliceDoc(from, to) || '图片'

    view.dispatch({
      changes: { from, to, insert: `![${selectedText}](${imageUrlInput.trim()})` }
    })
    view.focus()
    setImageUrlInput('')
    setShowImageUrlModal(false)
  }

  const insertList = (ordered = false) => {
    const view = viewRef.current
    if (!view || !canEdit) return

    const { from } = view.state.selection.main
    const line = view.state.doc.lineAt(from)
    const prefix = ordered ? '1. ' : '- '

    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix }
    })
    view.focus()
  }

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        const token = localStorage.getItem('token')
        if (!token) {
          setError('请先登录')
          setLoading(false)
          return
        }

        const res = await fetch(`/api/docs/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || '无法访问文档')
          setLoading(false)
          return
        }

        const doc = await res.json()
        setTitle(doc.title || 'Untitled')
        setDescription(doc.description || '')
        setPermission(doc.permission || 'private')
        setCanEdit(doc.canEdit !== false)
        const ownerStatus = doc.ownerId === user.id
        setIsOwner(ownerStatus)
        setInvitedUsers(doc.invitedUsers || [])
        contentRef.current = ''
        
        if (ownerStatus) {
          setTimeout(() => fetchDocInvitations(), 0)
        }
        
        const usersRes = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (usersRes.ok) {
          const usersData = await usersRes.json()
          setAllUsers(usersData)
        }

        setLoading(false)
      } catch (err) {
        console.error('Init error:', err)
        setError('加载失败')
        setLoading(false)
      }
    }

    fetchDoc()
  }, [id, user.id, permissionChanged])

  useEffect(() => {
    if (loading) return

    const ydoc = new Y.Doc()
    ydocRef.current = ydoc

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = localStorage.getItem('token')
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${encodeURIComponent(token || '')}&docId=${encodeURIComponent(id || '')}`
    const provider = new WebsocketProvider(wsUrl, id, ydoc)
    providerRef.current = provider

    const ytext = ydoc.getText('content')
    
    provider.awareness.setLocalStateField('user', {
      name: user.username,
      color: '#' + Math.floor(Math.random()*16777215).toString(16)
    })

    provider.awareness.on('change', () => {
      const states = Array.from(provider.awareness.getStates().values())
      setOnlineUsers(states.filter(s => s.user).map(s => s.user))
    })

    provider.on('status', event => {
      console.log('WebSocket状态变更:', event.status)
      setConnected(event.status === 'connected')
    })

    const setupCloseListener = () => {
      if (provider.ws) {
        provider.ws.addEventListener('close', (event) => {
          console.log('WebSocket关闭事件:', event.code, event.reason)
          if (event.code === 1008 && (event.reason.includes('Permission') || event.reason.includes('permission'))) {
            console.log('检测到权限变更，重新获取文档信息')
            setPermissionChanged(prev => prev + 1)
          }
        })
        console.log('WebSocket关闭监听器已添加')
      } else {
        setTimeout(setupCloseListener, 100)
      }
    }
    
    setupCloseListener()

    ytext.observe(() => {
      contentRef.current = ytext.toString()
      setContent(contentRef.current)
    })

    const handlePaste = async (event) => {
      if (!canEdit || uploadingImage) return
      const items = event.clipboardData?.items
      if (!items) return

      let hasImage = false
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          hasImage = true
          const file = item.getAsFile()
          if (!file) return
          
          setUploadingImage(true)
          const formData = new FormData()
          formData.append('image', file)

          try {
            const token = localStorage.getItem('token')
            const res = await fetch('/api/upload', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: formData
            })
            
            let data
            try {
              const text = await res.text()
              if (!text) {
                throw new Error('服务器返回空响应')
              }
              data = JSON.parse(text)
            } catch (parseError) {
              console.error('JSON解析错误:', parseError)
              throw new Error('图片上传失败，服务器响应格式错误')
            }
            
            if (!res.ok) throw new Error(data.error || '图片上传失败')
            
            if (data.url) {
              const imageMarkdown = `\n![image](${data.url})\n`
              const pos = viewRef.current?.state.doc.length || 0
              viewRef.current?.dispatch({
                changes: { from: pos, insert: imageMarkdown }
              })
            }
          } catch (err) {
            console.error('Failed to upload image:', err)
            setError(err.message)
          } finally {
            setUploadingImage(false)
          }
          break
        }
      }
      
      if (!hasImage) {
        const text = event.clipboardData.getData('text/plain')
        if (text) {
          event.preventDefault()
          const view = viewRef.current
          if (view) {
            const { from, to } = view.state.selection.main
            view.dispatch({
              changes: { from, to, insert: text }
            })
          }
        }
        return
      }
    }

    const handleEditorScroll = (event) => {
      if (isScrolling.current || !previewRef.current || viewMode !== 'split') return
      isScrolling.current = true
      
      const editor = event.target
      const preview = previewRef.current
      const maxEditorScroll = editor.scrollHeight - editor.clientHeight
      const maxPreviewScroll = preview.scrollHeight - preview.clientHeight
      
      if (maxEditorScroll <= 0 || maxPreviewScroll <= 0) {
        isScrolling.current = false
        return
      }
      
      const scrollRatio = editor.scrollTop / maxEditorScroll
      const targetPreviewScroll = scrollRatio * maxPreviewScroll
      
      preview.scrollTop = targetPreviewScroll
      
      setTimeout(() => { isScrolling.current = false }, 50)
    }

    const createEditor = () => {
      if (!editorRef.current || viewRef.current) return

      const state = EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          keymap.of([indentWithTab, ...defaultKeymap]),
          markdown({
            base: markdownLanguage,
            codeLanguages: languages
          }),
          oneDark,
          yCollab(ytext, provider.awareness),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              contentRef.current = update.state.doc.toString()
              setContent(contentRef.current)
            }
          }),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste: handlePaste
          }),
          EditorView.editable.of(canEdit)
        ]
      })

      viewRef.current = new EditorView({
        state,
        parent: editorRef.current
      })

      editorScrollRef.current = viewRef.current.scrollDOM
      if (editorScrollRef.current) {
        editorScrollRef.current.addEventListener('scroll', handleEditorScroll)
      }
    }

    const destroyEditor = () => {
      if (editorScrollRef.current) {
        editorScrollRef.current.removeEventListener('scroll', handleEditorScroll)
      }
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }

    if (viewMode === 'preview') {
      destroyEditor()
    } else {
      setTimeout(createEditor, 50)
    }

    return () => {
      destroyEditor()
      provider.disconnect()
      ydoc.destroy()
    }
  }, [loading, id, user.username, canEdit, viewMode])

  const saveTitle = async (newTitle) => {
    if (!canEdit) return
    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/docs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      })
      setTitle(newTitle)
    } catch (err) {
      console.error('Failed to save title:', err)
    }
  }

  const saveDescription = async (newDescription) => {
    if (!canEdit) return
    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/docs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ description: newDescription })
      })
      setDescription(newDescription)
    } catch (err) {
      console.error('Failed to save description:', err)
    }
  }

  const changePermission = async (newPerm) => {
    if (!isOwner) {
      alert('只有文档创建者可以更改权限')
      return
    }
    
    if (newPerm === 'private' && (invitedUsers.length > 0 || docInvitations.length > 0)) {
      const confirmed = confirm('切换为私有模式将移除所有已邀请的用户和待处理的邀请。确定要继续吗？')
      if (!confirmed) return
    }
    
    try {
      const token = localStorage.getItem('token')
      
      if (newPerm === 'private') {
        for (const userId of invitedUsers) {
          await fetch(`/api/docs/${id}/invitations/${userId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
        }
        setInvitedUsers([])
      }
      
      await fetch(`/api/docs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ permission: newPerm })
      })
      setPermission(newPerm)
      if (newPerm === 'private') {
        setInvitedUsers([])
      }
    } catch (err) {
      console.error('Failed to change permission:', err)
    }
  }

  const fetchDocInvitations = async () => {
    if (!isOwner || !id) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}/invitations/manage`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const invitations = await res.json()
        setDocInvitations(invitations)
      }
    } catch (err) {
      console.error('Failed to fetch invitations:', err)
    }
  }

  useEffect(() => {
    if (showInviteManagement && isOwner && id) {
      fetchDocInvitations()
      
      pollIntervalRef.current = setInterval(() => {
        fetchDocInvitations()
      }, 5000)
      
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    }
  }, [showInviteManagement, isOwner, id])

  const updateUserPermission = async (userId, newPermission) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}/invitations/${userId}/permission`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ permission: newPermission })
      })
      if (res.ok) {
        fetchDocInvitations()
      } else {
        alert('更新权限失败')
      }
    } catch (err) {
      console.error('Failed to update permission:', err)
      alert('更新权限失败')
    }
  }

  const removeInvitation = async (userId, username, isSharedUser = false) => {
    const message = isSharedUser 
      ? `确定要移除用户 ${username} 吗？用户将失去对本文档的访问权限。`
      : '确定要移除这个邀请吗？'
    if (!confirm(message)) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}/invitations/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchDocInvitations()
      } else {
        alert('移除失败')
      }
    } catch (err) {
      console.error('Failed to remove invitation:', err)
      alert('移除失败')
    }
  }

  const handleInvite = async () => {
    if (!inviteUsername) return
    if (!isOwner) {
      alert('只有文档创建者可以邀请用户')
      return
    }
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          username: inviteUsername,
          permission: invitePermission 
        })
      })
      if (res.ok) {
        const doc = await res.json()
        setInvitedUsers(doc.invitedUsers || [])
        setInviteUsername('')
        setInvitePermission('read')
        setShowInviteModal(false)
        fetchDocInvitations()
      } else {
        alert('用户不存在')
      }
    } catch (err) {
      console.error('Failed to invite:', err)
    }
  }

  const removeInvite = async (userId) => {
    if (!isOwner) return
    const user = allUsers.find(u => u.id === userId)
    const username = user?.username || 'Unknown User'
    removeInvitation(userId, username, false)
    setInvitedUsers(invitedUsers.filter(id => id !== userId))
  }

  const invitedUserNames = allUsers.filter(u => invitedUsers.includes(u.id)).map(u => u.username)

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '100px' }}>
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '100px' }}>
        <div className="card">
          <div className="empty-state">
            <div className="icon">⚠️</div>
            <h3>错误</h3>
            <p>{error}</p>
          </div>
          <button className="btn btn-primary" style={{ marginTop: '20px' }} onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-container">
      {sidebarVisible && (
        <div className="editor-sidebar">
        <div style={{ marginBottom: '20px' }}>
          <Link to="/" className="btn btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            返回首页
          </Link>
        </div>
        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'block', fontWeight: 600 }}>文章名称</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={e => saveTitle(e.target.value)}
            placeholder="文档标题"
            disabled={!canEdit}
          />
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'block', fontWeight: 600 }}>备注</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={e => saveDescription(e.target.value)}
            placeholder="请输入备注（可选）"
            disabled={!canEdit}
            rows={3}
            style={{ resize: 'vertical' }}
          />
        </div>
        
        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'block', fontWeight: 600 }}>访问权限</label>
          <select
            value={permission}
            onChange={e => changePermission(e.target.value)}
            disabled={!isOwner}
            style={{ marginBottom: '8px' }}
          >
            {Object.entries(PERMISSION_LABELS).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>
          <small style={{ color: '#94a3b8', fontSize: '12px' }}>{PERMISSION_LABELS[permission]?.desc}</small>
        </div>

        {permission === 'custom' && isOwner && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button className="btn btn-primary" style={{ flex: 1, fontSize: '13px', padding: '10px' }} onClick={() => setShowInviteModal(true)}>
                + 邀请用户
              </button>
              <button className="btn btn-secondary" style={{ flex: 1, fontSize: '13px', padding: '10px' }} onClick={() => setShowInviteManagement(true)}>
                管理邀请
              </button>
            </div>
            {invitedUserNames.length > 0 && (
              <div style={{ marginTop: '12px', fontSize: '13px' }}>
                <strong style={{ color: '#64748b', fontSize: '12px' }}>已邀请:</strong>
                {invitedUserNames.map((name, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                    <span>{name}</span>
                    <button 
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      onClick={() => removeInvite(invitedUsers[i])}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!canEdit && (
          <div style={{ padding: '12px', background: '#fef3c7', borderRadius: '10px', marginBottom: '20px', fontSize: '13px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            只读模式
          </div>
        )}

        <div style={{ marginBottom: '20px', fontSize: '14px' }}>
          <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: connected ? '#22c55e' : '#ef4444' 
            }} />
            {connected ? '已连接' : '连接中...'}
          </div>
          {onlineUsers.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <strong style={{ fontSize: '12px', color: '#64748b' }}>在线用户:</strong>
              <div className="online-users">
                {onlineUsers.map((u, i) => (
                  <div key={i} className="online-user">
                    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: u.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}>
                      {u.name.charAt(0).toUpperCase()}
                    </span>
                    {u.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 'auto', padding: '16px', background: '#f8fafc', borderRadius: '10px' }}>
          <strong style={{ color: '#64748b' }}>💡 提示</strong>
          <p style={{ marginTop: '8px' }}>直接在编辑器中粘贴图片即可上传</p>
        </div>
        </div>
      )}

      <div className="editor-main">
        <div className="editor-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="btn btn-secondary"
              onClick={() => setSidebarVisible(!sidebarVisible)}
              title={sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
              style={{ padding: '8px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {sidebarVisible ? (
                  <><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></>
                ) : (
                  <><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></>
                )}
              </svg>
              {sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
            </button>
            <div style={{ position: 'relative' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setViewModeMenuOpen(!viewModeMenuOpen)}
                disabled={uploadingImage}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {viewMode === 'edit' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.z"/></svg>}
                {viewMode === 'split' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>}
                {viewMode === 'preview' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                {viewMode === 'edit' ? '编辑' : viewMode === 'split' ? '双栏' : '预览'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {viewModeMenuOpen && (
                <div style={{ 
                  position: 'absolute', 
                  top: '100%', 
                  left: 0, 
                  marginTop: '4px', 
                  background: 'white', 
                  border: '1px solid #e2e8f0', 
                  borderRadius: '8px', 
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  zIndex: 1000,
                  minWidth: '120px'
                }}>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => { setViewMode('edit'); setViewModeMenuOpen(false); }}
                    disabled={uploadingImage}
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '8px 8px 0 0', border: 'none', background: viewMode === 'edit' ? undefined : 'transparent', color: viewMode === 'edit' ? undefined : '#374151' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.z"/></svg>
                    编辑
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => { setViewMode('split'); setViewModeMenuOpen(false); }}
                    disabled={uploadingImage}
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, border: 'none', background: viewMode === 'split' ? undefined : 'transparent', color: viewMode === 'split' ? undefined : '#374151' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    双栏
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => { setViewMode('preview'); setViewModeMenuOpen(false); }}
                    disabled={uploadingImage}
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '0 0 8px 8px', border: 'none', background: viewMode === 'preview' ? undefined : 'transparent', color: viewMode === 'preview' ? undefined : '#374151' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    预览
                  </button>
                </div>
              )}
            </div>
            <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('**', '**', '粗体')}
              disabled={!canEdit || uploadingImage}
              title="加粗 (Ctrl+B)"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('*', '*', '斜体')}
              disabled={!canEdit || uploadingImage}
              title="斜体 (Ctrl+I)"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('~~', '~~', '删除线')}
              disabled={!canEdit || uploadingImage}
              title="删除线"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.3 4.9c-2.3-.6-4.4-1-6.2-.9-2.7 0-5.3.7-5.3 3.6 0 1.5 1.8 3.3 3.6 3.9h.2"/><path d="M4 12h16"/><path d="M6.7 19.1c2.3.6 4.4 1 6.2.9 2.7 0 5.3-.7 5.3-3.6 0-1.5-1.8-3.3-3.6-3.9h-.2"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('`', '`', '行内代码')}
              disabled={!canEdit || uploadingImage}
              title="行内代码"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </button>
            <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
            <button 
              className="btn btn-secondary"
              onClick={insertLink}
              disabled={!canEdit || uploadingImage}
              title="插入链接"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
            <div style={{ position: 'relative' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setImageMenuOpen(!imageMenuOpen)}
                disabled={!canEdit || uploadingImage}
                title="插入图片"
                style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {imageMenuOpen && (
                <div style={{ 
                  position: 'absolute', 
                  top: '100%', 
                  left: 0, 
                  marginTop: '4px', 
                  background: 'white', 
                  border: '1px solid #e2e8f0', 
                  borderRadius: '8px', 
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  zIndex: 1000,
                  minWidth: '150px'
                }}>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => { setShowImageUrlModal(true); setImageMenuOpen(false); }}
                    disabled={uploadingImage}
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: '8px 8px 0 0', border: 'none', background: 'transparent', color: '#374151' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    插入网络图片
                  </button>
                  <label 
                    style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', cursor: 'pointer', borderRadius: '0 0 8px 8px', border: 'none', background: 'transparent', color: '#374151', fontSize: '14px' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    从本地上传
                    <input 
                      type="file" 
                      accept="image/*" 
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setImageMenuOpen(false)
                        setUploadingImage(true)
                        const formData = new FormData()
                        formData.append('image', file)
                        try {
                          const token = localStorage.getItem('token')
                          const res = await fetch('/api/upload', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                            body: formData
                          })
                          const data = await res.json()
                          if (!res.ok) throw new Error(data.error || '图片上传失败')
                          if (data.url) {
                            const imageMarkdown = `\n![image](${data.url})\n`
                            const pos = viewRef.current?.state.doc.length || 0
                            viewRef.current?.dispatch({
                              changes: { from: pos, insert: imageMarkdown }
                            })
                          }
                        } catch (err) {
                          console.error('Failed to upload image:', err)
                          alert(err.message)
                        } finally {
                          setUploadingImage(false)
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
            <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
            <button 
              className="btn btn-secondary"
              onClick={() => insertList(false)}
              disabled={!canEdit || uploadingImage}
              title="无序列表"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertList(true)}
              disabled={!canEdit || uploadingImage}
              title="有序列表"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('\n```\n', '\n```\n', '代码块')}
              disabled={!canEdit || uploadingImage}
              title="代码块"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8l4 4-4 4"/><line x1="13" y1="16" x2="17" y2="16"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('\n> ', '\n', '引用')}
              disabled={!canEdit || uploadingImage}
              title="引用"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => insertMarkdown('\n---\n', '', '')}
              disabled={!canEdit || uploadingImage}
              title="水平线"
              style={{ padding: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          {uploadingImage ? (
            <button
              className="btn btn-secondary"
              disabled
              style={{ fontSize: '13px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle' }}>
                 <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                 <polyline points="14 2 14 8 20 8"/>
                 <line x1="16" y1="13" x2="8" y2="13"/>
                 <line x1="16" y1="17" x2="8" y2="17"/>
                 <polyline points="10 9 9 9 8 9"/>
               </svg>
               首页
            </button>
          ) : (
            <Link
              to="/"
              className="btn btn-secondary"
              style={{ fontSize: '13px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              首页
            </Link>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {uploadingImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '13px' }}>
                <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#6366f1', animation: 'pulse 1.5s infinite' }} />
                图片上传中...
              </div>
            )}
          </div>
        </div>
        <div className="editor-wrapper">
          {(viewMode === 'edit' || viewMode === 'split') && (
            <div ref={editorRef} className="editor-panel" />
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div 
              ref={previewRef}
              className="preview markdown-body" 
              onScroll={(e) => {
                if (viewMode !== 'split' || isScrolling.current) return
                isScrolling.current = true
                
                const preview = e.target
                const editor = editorScrollRef.current
                const maxPreviewScroll = preview.scrollHeight - preview.clientHeight
                const maxEditorScroll = editor ? editor.scrollHeight - editor.clientHeight : 0
                
                if (maxPreviewScroll <= 0 || maxEditorScroll <= 0) {
                  isScrolling.current = false
                  return
                }
                
                const scrollRatio = preview.scrollTop / maxPreviewScroll
                const targetEditorScroll = scrollRatio * maxEditorScroll
                
                if (editor) {
                  editor.scrollTop = targetEditorScroll
                }
                
                setTimeout(() => { isScrolling.current = false }, 50)
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  code({node, inline, className, children, ...props}) {
                    const match = /language-(\w+)/.exec(className || '')
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={hljsTheme}
                        language={match[1]}
                        PreTag="div"
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    )
                  }
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>邀请用户</h2>
            <div className="form-group">
              <input
                type="text"
                placeholder="输入用户名"
                value={inviteUsername}
                onChange={e => setInviteUsername(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px', display: 'block', fontWeight: 600 }}>权限</label>
              <select 
                value={invitePermission}
                onChange={e => setInvitePermission(e.target.value)}
              >
                <option value="read">只读</option>
                <option value="readwrite">读写</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleInvite}>邀请</button>
            </div>
          </div>
        </div>
      )}

      {showImageUrlModal && (
        <div className="modal-overlay" onClick={() => setShowImageUrlModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>插入网络图片</h2>
            <div className="form-group">
              <input
                type="text"
                placeholder="输入图片链接"
                value={imageUrlInput}
                onChange={e => setImageUrlInput(e.target.value)}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && insertImageFromUrl()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowImageUrlModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={insertImageFromUrl}>插入</button>
            </div>
          </div>
        </div>
      )}

      {showInviteManagement && (
        <div className="modal-overlay" onClick={() => setShowInviteManagement(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h2>邀请管理</h2>
            
            {docInvitations.length === 0 ? (
              <div className="empty-state">
                <div className="icon">📭</div>
                <h3>暂无邀请记录</h3>
                <p>向用户发送邀请后，他们将显示在这里</p>
              </div>
            ) : (
              <div className="invitation-list">
                {docInvitations.map((inv, index) => (
                  <div key={`${inv.userId}-${inv.type}-${index}`} className="invitation-item">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {inv.username}
                        <span style={{ 
                          fontSize: '11px', 
                          padding: '3px 10px', 
                          borderRadius: '12px', 
                          background: inv.status === 'accepted' ? '#dcfce7' : 
                                    inv.status === 'pending' ? '#fef3c7' : '#fee2e2',
                          color: inv.status === 'accepted' ? '#166534' : 
                                inv.status === 'pending' ? '#92400e' : '#991b1b',
                          fontWeight: 500
                        }}>
                          {inv.status === 'accepted' ? '✓ 已接受' : 
                           inv.status === 'pending' ? '⏳ 等待接受' : '✕ 已拒绝'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>
                        🔐 权限: {inv.permission === 'readwrite' ? '读写' : '只读'}
                        {inv.type === 'pending' && inv.invitedAt && (
                          <span> • 🕐 邀请时间: {new Date(inv.invitedAt).toLocaleString()}</span>
                        )}
                        {inv.type === 'shared' && inv.joinedAt && (
                          <span> • 🕐 加入时间: {new Date(inv.joinedAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {inv.type === 'shared' && (
                        <>
                          <select 
                            value={inv.permission}
                            onChange={e => updateUserPermission(inv.userId, e.target.value)}
                            className="permission-select"
                          >
                            <option value="read">只读</option>
                            <option value="readwrite">读写</option>
                          </select>
                          <button 
                            className="btn btn-danger"
                            style={{ padding: '8px 12px', fontSize: '12px' }}
                            onClick={() => removeInvitation(inv.userId, inv.username, true)}
                          >
                            移除
                          </button>
                        </>
                      )}
                      
                      {inv.type === 'pending' && inv.status === 'pending' && (
                        <button 
                          className="btn btn-danger"
                          style={{ padding: '8px 12px', fontSize: '12px' }}
                          onClick={() => removeInvitation(inv.userId, inv.username, false)}
                        >
                          取消邀请
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInviteManagement(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

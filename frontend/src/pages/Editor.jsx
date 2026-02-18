import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
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
      const scrollPercent = event.target.scrollTop / (event.target.scrollHeight - event.target.clientHeight)
      const previewScrollHeight = previewRef.current.scrollHeight - previewRef.current.clientHeight
      previewRef.current.scrollTop = scrollPercent * previewScrollHeight
      setTimeout(() => { isScrolling.current = false }, 50)
    }

    const createEditor = () => {
      if (!editorRef.current || viewRef.current) return

      const state = EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          markdown(),
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
            <button 
              className={`btn ${viewMode === 'edit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('edit')}
              disabled={uploadingImage}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.z"/></svg>
              编辑
            </button>
            <button 
              className={`btn ${viewMode === 'split' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('split')}
              disabled={uploadingImage}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
              双栏
            </button>
            <button 
              className={`btn ${viewMode === 'preview' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('preview')}
              disabled={uploadingImage}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              预览
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
            <button 
              className="btn btn-secondary" 
              onClick={() => navigator.clipboard.writeText(content)}
              disabled={uploadingImage}
              style={{ fontSize: '13px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              复制内容
            </button>
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
                const scrollPercent = e.target.scrollTop / (e.target.scrollHeight - e.target.clientHeight)
                if (editorScrollRef.current) {
                  const editorScrollHeight = editorScrollRef.current.scrollHeight - editorScrollRef.current.clientHeight
                  editorScrollRef.current.scrollTop = scrollPercent * editorScrollHeight
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

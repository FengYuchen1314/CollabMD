import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('my-docs')
  const [myDocs, setMyDocs] = useState([])
  const [sharedDocs, setSharedDocs] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocDesc, setNewDocDesc] = useState('')
  const { user } = useAuth()
  const navigate = useNavigate()
  const pollIntervalRef = useRef(null)

  const fetchAllDocs = async () => {
    try {
      const token = localStorage.getItem('token')
      
      const [myDocsRes, sharedDocsRes, invitationsRes] = await Promise.all([
        fetch('/api/docs', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('/api/docs/shared', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('/api/docs/invitations', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ])

      if (!myDocsRes.ok) throw new Error('获取我的文档失败')
      if (!sharedDocsRes.ok) throw new Error('获取共享文档失败')
      if (!invitationsRes.ok) throw new Error('获取邀请失败')

      const myDocsData = await myDocsRes.json()
      const sharedDocsData = await sharedDocsRes.json()
      const invitationsData = await invitationsRes.json()

      setMyDocs(myDocsData)
      setSharedDocs(sharedDocsData)
      setInvitations(invitationsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllDocs()
    
    pollIntervalRef.current = setInterval(() => {
      const fetchInvitationsOnly = async () => {
        try {
          const token = localStorage.getItem('token')
          const res = await fetch('/api/docs/invitations', {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            const invitationsData = await res.json()
            setInvitations(invitationsData)
          }
        } catch (err) {
          console.error('Failed to fetch invitations:', err)
        }
      }
      
      fetchInvitationsOnly()
    }, 10000)
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  const createDoc = async () => {
    if (!newDocTitle.trim()) {
      alert('请输入文档名称')
      return
    }
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: newDocTitle, description: newDocDesc })
      })
      if (!res.ok) throw new Error('创建文档失败')
      const doc = await res.json()
      setShowCreateModal(false)
      setNewDocTitle('')
      setNewDocDesc('')
      navigate(`/doc/${doc.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const openCreateModal = () => {
    setNewDocTitle('')
    setNewDocDesc('')
    setShowCreateModal(true)
  }

  const deleteDoc = async (e, id, isShared = false) => {
    e.stopPropagation()
    if (!confirm('确定要删除这个文档吗?')) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('删除文档失败')
      
      if (isShared) {
        setSharedDocs(sharedDocs.filter(doc => doc.id !== id))
      } else {
        setMyDocs(myDocs.filter(doc => doc.id !== id))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const leaveDoc = async (e, id) => {
    e.stopPropagation()
    if (!confirm('确定要离开这个共享文档吗?')) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${id}/leave`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('离开文档失败')
      
      setSharedDocs(sharedDocs.filter(doc => doc.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  const handleAcceptInvitation = async (e, docId) => {
    e.stopPropagation()
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${docId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('接受邀请失败')
      
      setInvitations(invitations.filter(inv => inv.docId !== docId))
      fetchAllDocs()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDeclineInvitation = async (e, docId) => {
    e.stopPropagation()
    if (!confirm('确定要拒绝这个邀请吗?')) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/docs/${docId}/decline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('拒绝邀请失败')
      
      setInvitations(invitations.filter(inv => inv.docId !== docId))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-error">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      </div>
    )
  }

  const currentDocs = activeTab === 'my-docs' ? myDocs : activeTab === 'shared-docs' ? sharedDocs : []
  const isMyDocsTab = activeTab === 'my-docs'
  const isSharedDocsTab = activeTab === 'shared-docs'
  const isInvitationsTab = activeTab === 'invitations'

  return (
    <div className="container">
      <div className="card">
        <div className="page-header">
          <h1>📄 我的文档</h1>
          {isMyDocsTab && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新建文档
            </button>
          )}
        </div>

        <div className="tab-buttons">
          <button
            className={`btn ${activeTab === 'my-docs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('my-docs')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            我创建的文档 ({myDocs.length})
          </button>
          <button
            className={`btn ${activeTab === 'shared-docs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('shared-docs')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            他人共享 ({sharedDocs.length})
          </button>
          <button
            className={`btn ${activeTab === 'invitations' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('invitations')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            邀请管理 {invitations.length > 0 && <span style={{ 
              background: '#ef4444', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '10px', 
              fontSize: '12px',
              marginLeft: '6px'
            }}>{invitations.length}</span>}
          </button>
        </div>

        {isInvitationsTab ? (
           invitations.length === 0 ? (
             <div className="empty-state">
               <div className="icon">📭</div>
               <h3>暂无待处理的邀请</h3>
               <p>当有人邀请您协作文档时，邀请将显示在这里</p>
             </div>
           ) : (
             <div className="doc-list">
               {invitations.map(inv => (
                 <div key={inv.docId} className="doc-item">
                   <div className="doc-icon">📝</div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                     <h3>{inv.docTitle}</h3>
                   </div>
                   <p>👤 邀请人: {inv.invitedBy}</p>
                   <p>🔐 权限: {inv.permission === 'readwrite' ? '读写' : '只读'}</p>
                   <p>🕐 邀请时间: {new Date(inv.invitedAt).toLocaleString()}</p>
                   <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                     <button
                       className="btn btn-success"
                       style={{ flex: 1, padding: '10px' }}
                       onClick={(e) => handleAcceptInvitation(e, inv.docId)}
                     >
                       ✅ 接受
                     </button>
                     <button
                       className="btn btn-danger"
                       style={{ flex: 1, padding: '10px' }}
                       onClick={(e) => handleDeclineInvitation(e, inv.docId)}
                     >
                       ❌ 拒绝
                     </button>
                   </div>
                 </div>
               ))}
             </div>
           )
         ) : currentDocs.length === 0 ? (
           <div className="empty-state">
             <div className="icon">📄</div>
             <h3>{isMyDocsTab ? '暂无文档' : '暂无共享文档'}</h3>
             <p>{isMyDocsTab 
               ? '点击"新建文档"按钮开始创建您的第一个文档' 
               : '他人共享给你的文档将出现在这里'}</p>
           </div>
         ) : (
           <div className="doc-list">
             {currentDocs.map(doc => (
               <div key={doc.id} className="doc-item" onClick={() => navigate(`/doc/${doc.id}`)}>
                 <div className="doc-icon">📄</div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                   <h3>{doc.title}</h3>
                 </div>
                 {doc.description && (
                   <p style={{ color: '#64748b', fontSize: '13px', marginTop: '4px', fontStyle: 'italic' }}>📝 {doc.description}</p>
                 )}
                 <p>{isMyDocsTab 
                   ? `📅 创建于: ${new Date(doc.createdAt).toLocaleDateString()}`
                   : `👤 共享者: ${doc.ownerId}`}</p>
                 {isMyDocsTab ? (
                   <p>🕐 最后更新: {new Date(doc.updatedAt).toLocaleDateString()}</p>
                 ) : (
                   <p>🔐 权限: {doc.canEdit ? '读写' : '只读'}</p>
                 )}
                 <div className="doc-meta">
                   {isMyDocsTab ? (
                     <button
                       className="btn btn-danger"
                       style={{ padding: '6px 12px', fontSize: '12px' }}
                       onClick={(e) => deleteDoc(e, doc.id, false)}
                     >
                       🗑️ 删除
                     </button>
                   ) : (
                     <button
                       className="btn btn-warning"
                       style={{ padding: '6px 12px', fontSize: '12px' }}
                       onClick={(e) => leaveDoc(e, doc.id)}
                     >
                       🚪 离开
                     </button>
                   )}
                 </div>
               </div>
             ))}
           </div>
         )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>创建新文档</h2>
            <div className="form-group">
              <label>文档名称 *</label>
              <input
                type="text"
                placeholder="请输入文档名称"
                value={newDocTitle}
                onChange={e => setNewDocTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>备注（可选）</label>
              <textarea
                placeholder="请输入备注（可选）"
                value={newDocDesc}
                onChange={e => setNewDocDesc(e.target.value)}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={createDoc}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

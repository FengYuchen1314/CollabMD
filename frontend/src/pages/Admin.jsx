import { useState, useEffect } from 'react'
import { useAuth } from '../App'

export default function Admin() {
  const [users, setUsers] = useState([])
  const [config, setConfig] = useState({ storageType: 'local' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token')
      const [usersRes, configRes] = await Promise.all([
        fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/config', { headers: { Authorization: `Bearer ${token}` } })
      ])
      const usersData = await usersRes.json()
      const configData = await configRes.json()
      setUsers(usersData)
      setConfig({ ...configData, s3: configData.s3 || {} })
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const saveConfig = async () => {
    setSaving(true)
    setMessage('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(config)
      })
      if (res.ok) {
        setMessage('✅ 配置已保存')
      } else {
        setMessage('❌ 保存失败')
      }
    } catch (err) {
      setMessage('❌ 保存失败')
    } finally {
      setSaving(false)
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

  return (
    <div className="container">
      <div className="page-header">
        <h1>⚙️ 管理面板</h1>
      </div>
      
      <div className="card">
        <h2 style={{ marginBottom: '20px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          用户列表
        </h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>文档数量</th>
              <th>注册时间</th>
              <th>角色</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="user-avatar" style={{ width: '28px', height: '28px', fontSize: '12px' }}>
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <strong>{u.username}</strong>
                  </div>
                </td>
                <td>
                  <span style={{ 
                    background: '#e0e7ff', 
                    color: '#4338ca', 
                    padding: '4px 12px', 
                    borderRadius: '20px', 
                    fontSize: '13px',
                    fontWeight: 600
                  }}>
                    {u.docCount}
                  </span>
                </td>
                <td style={{ color: '#64748b' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  {u.isAdmin ? (
                    <span style={{ 
                      background: '#fef3c7', 
                      color: '#92400e', 
                      padding: '4px 12px', 
                      borderRadius: '20px', 
                      fontSize: '12px',
                      fontWeight: 600
                    }}>
                      管理员
                    </span>
                  ) : (
                    <span style={{ 
                      background: '#f1f5f9', 
                      color: '#64748b', 
                      padding: '4px 12px', 
                      borderRadius: '20px', 
                      fontSize: '12px',
                      fontWeight: 600
                    }}>
                      用户
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '20px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          存储配置
        </h2>
        {message && (
          <div className={`alert ${message.includes('失败') ? 'alert-error' : 'alert-success'}`}>
            {message}
          </div>
        )}
        <div className="form-group">
          <label>存储类型</label>
          <select
            value={config.storageType}
            onChange={e => setConfig({ ...config, storageType: e.target.value })}
          >
            <option value="local">💾 本地存储</option>
            <option value="s3">☁️ S3 对象存储</option>
          </select>
        </div>

        <div className="form-group">
          <label>图片重命名规则</label>
          <select
            value={config.imageRenameRule || 'uuid'}
            onChange={e => setConfig({ ...config, imageRenameRule: e.target.value })}
          >
            <option value="uuid">🔑 UUID (默认)</option>
            <option value="original">📝 保持原名称 (重复时自动添加001、002...)</option>
            <option value="timestamp">⏰ 时间戳</option>
          </select>
        </div>

        {config.storageType === 's3' && (
          <>
            <div className="form-group">
              <label>API Endpoint (如 cn-nb1.rains3.com)</label>
              <input
                type="text"
                value={config.s3?.endpoint || ''}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, endpoint: e.target.value } })}
                placeholder="cn-nb1.rains3.com"
              />
            </div>
            <div className="form-group">
              <label>存储文件夹</label>
              <input
                type="text"
                value={config.s3?.folder || 'md-image'}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, folder: e.target.value } })}
                placeholder="md-image"
              />
            </div>
            <div className="form-group">
              <label>S3 区域</label>
              <input
                type="text"
                value={config.s3?.region || ''}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, region: e.target.value } })}
                placeholder="auto"
              />
            </div>
            <div className="form-group">
              <label>S3 Bucket 名称</label>
              <input
                type="text"
                value={config.s3?.bucket || ''}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, bucket: e.target.value } })}
                placeholder="my-bucket"
              />
            </div>
            <div className="form-group">
              <label>S3 访问方式</label>
              <select
                value={config.s3?.accessStyle || 'virtual'}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, accessStyle: e.target.value } })}
              >
                <option value="virtual">🌐 对象式访问 (virtual-hosted)</option>
                <option value="path">📁 路径式访问 (path-style)</option>
              </select>
              <small style={{ color: '#64748b', fontSize: '12px', display: 'block', marginTop: '6px' }}>
                {config.s3?.accessStyle === 'virtual' 
                  ? 'URL格式: https://bucket.endpoint.com/key' 
                  : 'URL格式: https://endpoint.com/bucket/key'}
              </small>
            </div>
            <div className="form-group">
              <label>Access Key ID</label>
              <input
                type="text"
                value={config.s3?.accessKeyId || ''}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, accessKeyId: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label>Secret Access Key</label>
              <input
                type="password"
                value={config.s3?.secretAccessKey || ''}
                onChange={e => setConfig({ ...config, s3: { ...config.s3, secretAccessKey: e.target.value } })}
              />
            </div>
          </>
        )}

        <button className="btn btn-primary" onClick={saveConfig} disabled={saving} style={{ marginTop: '8px' }}>
          {saving ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span>
              保存中...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              保存配置
            </>
          )}
        </button>
      </div>
    </div>
  )
}

let token = '';

const $ = id => document.getElementById(id);
const toast = (msg, isError = false) => {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
};

document.addEventListener('DOMContentLoaded', () => {
    $('loginBtn').addEventListener('click', () => {
        token = $('tokenInput').value.trim();
        if (!token) { toast('请输入管理密钥', true); return; }
        $('loginSection').classList.add('hidden');
        $('mainSection').classList.remove('hidden');
        loadHistory();
        loadProviders();
    });

    $('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'providers') loadProviders();
        });
    });

    $('refreshBtn').addEventListener('click', loadHistory);
    $('refreshProvidersBtn').addEventListener('click', loadProviders);
    document.querySelector('#toggleAllProvidersBtn')?.addEventListener('click', toggleAllProviders);
    document.querySelector('#copyProxyBtn')?.addEventListener('click', function() {
        const url = window.location.origin + '/api/proxy';
        const textarea = document.querySelector('#apiOutput');
        if (textarea) {
            textarea.value = url;
            document.querySelector('#apiModal').classList.remove('hidden');
            toast('📋 已生成 TVBox 订阅链接');
        }
    });

    $('clearAllBtn').addEventListener('click', async () => {
        if (!confirm('⚠️ 确定要删除全部观看历史吗？此操作不可恢复！')) return;
        try {
            const res = await fetch('/api/admin/history', {
                method: 'DELETE',
                headers: { 'X-Admin-Token': token }
            });
            const data = await res.json();
            if (res.ok) { toast('✅ 已清空全部历史记录'); loadHistory(); }
            else { toast('❌ ' + (data.error || '操作失败'), true); }
        } catch (e) { toast('❌ 网络错误', true); }
    });

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-history-btn');
        if (!btn) return;
        const key = btn.dataset.key;
        if (!key) return;
        if (!confirm('确定要删除这条记录吗？')) return;
        try {
            const res = await fetch(`/api/admin/history?key=${encodeURIComponent(key)}`, {
                method: 'DELETE',
                headers: { 'X-Admin-Token': token }
            });
            const data = await res.json();
            if (res.ok) { toast('✅ 已删除'); loadHistory(); }
            else { toast('❌ ' + (data.error || '删除失败'), true); }
        } catch (e) { toast('❌ 网络错误', true); }
    });
});

async function loadHistory() {
    const body = $('historyBody');
    body.innerHTML = '<tr><td colspan="6" class="empty-state">加载中...</td></tr>';
    try {
        const res = await fetch('/api/admin/history', {
            headers: { 'X-Admin-Token': token }
        });
        const data = await res.json();
        if (!res.ok) { toast('❌ ' + (data.error || '加载失败'), true); body.innerHTML = '<tr><td colspan="6" class="empty-state">加载失败</td></tr>'; return; }
        $('totalCount').textContent = data.total || 0;
        $('lastUpdate').textContent = '更新于 ' + new Date().toLocaleString();
        if (!data.items || data.items.length === 0) {
            body.innerHTML = '<tr><td colspan="6" class="empty-state">📭 暂无观看历史</td></tr>';
            return;
        }
        body.innerHTML = data.items.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.name || '未命名')}</strong></td>
                <td>${escapeHtml(item.episodeName || '-')}</td>
                <td>${formatProgress(item.position, item.duration)}</td>
                <td>${escapeHtml(item.sourceName || item.providerName || '-')}</td>
                <td>${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}</td>
                <td><button class="btn btn-danger btn-sm delete-history-btn" data-key="${escapeHtml(item.key)}">删除</button></td>
            </tr>
        `).join('');
    } catch (e) {
        toast('❌ 加载失败', true);
        body.innerHTML = '<tr><td colspan="6" class="empty-state">加载失败</td></tr>';
    }
}

async function loadProviders() {
    const container = $('providerList');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">加载中...</div>';
    try {
        const res = await fetch('/api/admin/providers?_=' + Date.now(), {
            headers: { 'X-Admin-Token': token }
        });
        const data = await res.json();
        if (!res.ok) { container.innerHTML = '<div class="empty-state">加载失败</div>'; return; }

        const providers = data.providers || [];
        $('providerCount').textContent = providers.length;
        $('providerUpdate').textContent = '更新于 ' + new Date().toLocaleString();

        if (providers.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 暂无数据源</div>';
            return;
        }

        container.innerHTML = `
            <div class="category-section">
                <div class="category-header" style="background:#f8fafc;padding:0.6rem 1rem;border-radius:8px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;">全部数据源 <span class="badge">${providers.length}</span></span>
                    <span style="font-size:0.8rem;color:#94a3b8;">按优先级排序</span>
                </div>
                ${providers.map(p => `
                    <div class="provider-item" data-id="${escapeHtml(p.id)}">
                        <div class="info">
                            <span class="dot ${p.enabled ? 'on' : 'off'}"></span>
                            <strong>${escapeHtml(p.name)}</strong>
                            <span class="url">${escapeHtml(p.url || '')}</span>
                            ${p.priority ? `<span class="badge">优先级 ${p.priority}</span>` : ''}
                        </div>
                        <div class="actions">
                            <button class="btn ${p.enabled ? 'btn-warning' : 'btn-success'} btn-sm toggle-provider" data-id="${escapeHtml(p.id)}" data-current="${p.enabled}">
                                ${p.enabled ? '⏸ 停用' : '▶ 启用'}
                            </button>
                            <button class="btn btn-danger btn-sm delete-provider" data-id="${escapeHtml(p.id)}">🗑️ 删除</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        document.querySelectorAll('.toggle-provider').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.id;
                const current = btn.dataset.current === 'true';
                try {
                    const res = await fetch('/api/admin/providers', {
                        method: 'PUT',
                        headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, enabled: !current })
                    });
                    if (res.ok) { 
                        toast(`✅ 已${!current ? '启用' : '停用'}`); 
                        loadProviders(); 
                    } else {
                        toast('❌ 操作失败', true);
                    }
                } catch (e) { toast('❌ 网络错误', true); }
            };
        });

        document.querySelectorAll('.delete-provider').forEach(btn => {
            btn.onclick = async () => {
                if (!confirm('确定要删除这个数据源吗？')) return;
                const id = btn.dataset.id;
                try {
                    const res = await fetch(`/api/admin/providers/${id}`, {
                        method: 'DELETE',
                        headers: { 'X-Admin-Token': token }
                    });
                    if (res.ok) { toast('✅ 已删除'); loadProviders(); }
                    else { toast('❌ 删除失败', true); }
                } catch (e) { toast('❌ 网络错误', true); }
            };
        });

    } catch (e) {
        container.innerHTML = '<div class="empty-state">加载失败</div>';
    }
}

async function toggleAllProviders() {
    if (!confirm('确定要反转所有数据源的启用状态吗？')) return;
    try {
        const res = await fetch('/api/admin/providers?_=' + Date.now(), {
            headers: { 'X-Admin-Token': token }
        });
        const data = await res.json();
        const providers = data.providers || [];
        
        for (const p of providers) {
            await fetch('/api/admin/providers', {
                method: 'PUT',
                headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: p.id, enabled: !p.enabled })
            });
        }
        toast('✅ 已反转所有数据源状态');
        loadProviders();
    } catch (e) {
        toast('❌ 操作失败', true);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
}

function formatProgress(pos, dur) {
    if (!pos && pos !== 0) return '-';
    const p = Math.floor(pos);
    const d = Math.floor(dur || 0);
    const pct = d > 0 ? Math.round((p / d) * 100) : 0;
    return `${formatTime(p)} / ${formatTime(d)} (${pct}%)`;
}

function formatTime(sec) {
    if (!sec || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}window.copyProxyLink = function() {
    const url = window.location.origin + '/api/proxy';
    const textarea = document.querySelector('#apiOutput');
    if (textarea) {
        textarea.value = url;
        document.querySelector('#apiModal').classList.remove('hidden');
        toast('📋 已生成 TVBox 订阅链接');
    }
};
// ============================================================
// 完整代码 - 所有敏感信息从环境变量读取
// ============================================================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        // 从环境变量读取所有配置
        const GIT_REPO = env.GIT_REPO;
        const GIT_TOKEN = env.GIT_TOKEN;
        const LOGIN_PASSWORD = env.LOGIN_PASSWORD;
        const ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH;
        const PASSWORD_SALT = env.PASSWORD_SALT;

        // 检查必要配置
        if (!GIT_REPO || !GIT_TOKEN || !LOGIN_PASSWORD) {
            return new Response(JSON.stringify({
                error: '配置错误',
                message: '请在 Cloudflare Dashboard 设置环境变量'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // API 路由
        if (pathname === '/api/debug') {
            return handleDebug(env);
        }

        if (pathname === '/api/auth/login' && method === 'POST') {
            return handleLogin(request, LOGIN_PASSWORD);
        }

        if (pathname === '/api/auth/verify-admin' && method === 'POST') {
            return handleVerifyAdmin(request, ADMIN_PASSWORD_HASH, PASSWORD_SALT);
        }

        if (pathname === '/api/files/list' && method === 'POST') {
            return handleFileList(request, GIT_REPO, GIT_TOKEN);
        }

        if (pathname === '/api/files/content' && method === 'POST') {
            return handleFileContent(request, GIT_REPO, GIT_TOKEN);
        }

        if (pathname === '/api/files/upload' && method === 'POST') {
            return handleUploadFile(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD);
        }

        if (pathname === '/api/files/delete' && method === 'POST') {
            return handleDeleteFile(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD);
        }

        if (pathname === '/api/files/mkdir' && method === 'POST') {
            return handleMkdir(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD);
        }

        if (pathname === '/api/files/search' && method === 'POST') {
            return handleSearchFiles(request, GIT_REPO, GIT_TOKEN);
        }

        if (pathname === '/api/config' && method === 'GET') {
            return handleConfig(GIT_REPO);
        }

        // 页面路由
        if (pathname === '/' || pathname === '/index.html' || pathname === '/D-file.html') {
            return handleAdminPanel();
        }

        // 代理文件
        return proxyToFile(request, GIT_REPO, GIT_TOKEN, pathname);
    }
};

// ============================================================
// 辅助函数
// ============================================================

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getContentType(ext) {
    const types = {
        'html': 'text/html; charset=utf-8',
        'htm': 'text/html; charset=utf-8',
        'css': 'text/css; charset=utf-8',
        'js': 'application/javascript; charset=utf-8',
        'json': 'application/json; charset=utf-8',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'pdf': 'application/pdf',
        'zip': 'application/zip',
        'txt': 'text/plain; charset=utf-8',
        'md': 'text/plain; charset=utf-8'
    };
    return types[ext] || 'application/octet-stream';
}

// ============================================================
// 调试处理
// ============================================================

function handleDebug(env) {
    return new Response(JSON.stringify({
        GIT_REPO: env.GIT_REPO ? '已配置' : '未配置',
        GIT_TOKEN: env.GIT_TOKEN ? '已配置' : '未配置',
        LOGIN_PASSWORD: env.LOGIN_PASSWORD ? '已配置' : '未配置',
        ADMIN_PASSWORD_HASH: env.ADMIN_PASSWORD_HASH ? '已配置' : '未配置',
        PASSWORD_SALT: env.PASSWORD_SALT ? '已配置' : '未配置'
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// ============================================================
// 登录处理
// ============================================================

async function handleLogin(request, LOGIN_PASSWORD) {
    try {
        const { password } = await request.json();
        
        if (password === LOGIN_PASSWORD) {
            const timestamp = Date.now();
            const hash = await sha256(`${LOGIN_PASSWORD}:${timestamp}`);
            const token = `${timestamp}:${hash}`;
            
            return new Response(JSON.stringify({
                success: true,
                token: token
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return new Response(JSON.stringify({
            success: false,
            message: '密码错误'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function validateToken(token, LOGIN_PASSWORD) {
    try {
        const [timestamp, hash] = token.split(':');
        const expected = await sha256(`${LOGIN_PASSWORD}:${timestamp}`);
        return hash === expected && (Date.now() - parseInt(timestamp)) < 3600000;
    } catch {
        return false;
    }
}

// ============================================================
// 管理员验证
// ============================================================

async function handleVerifyAdmin(request, ADMIN_PASSWORD_HASH, PASSWORD_SALT) {
    try {
        const { password } = await request.json();
        const hashed = await sha256(PASSWORD_SALT + password);
        
        if (hashed === ADMIN_PASSWORD_HASH) {
            return new Response(JSON.stringify({
                success: true
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return new Response(JSON.stringify({
            success: false,
            message: '密码错误'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// 文件列表
// ============================================================

async function handleFileList(request, GIT_REPO, GIT_TOKEN) {
    try {
        const { path = '' } = await request.json();
        
        const response = await fetch(
            `https://api.github.com/repos/${GIT_REPO}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`GitHub API 错误: ${response.status}`);
        }
        
        const data = await response.json();
        
        return new Response(JSON.stringify({
            success: true,
            data: Array.isArray(data) ? data : [data]
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// 文件内容
// ============================================================

async function handleFileContent(request, GIT_REPO, GIT_TOKEN) {
    try {
        const { path } = await request.json();
        
        const response = await fetch(
            `https://api.github.com/repos/${GIT_REPO}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`GitHub API 错误: ${response.status}`);
        }
        
        const data = await response.json();
        let content = data.content;
        if (data.encoding === 'base64') {
            content = atob(data.content);
        }
        
        return new Response(JSON.stringify({
            success: true,
            data: { ...data, content }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// 上传文件
// ============================================================

async function handleUploadFile(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({
                success: false,
                message: '未授权'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const token = authHeader.substring(7);
        const isValid = await validateToken(token, LOGIN_PASSWORD);
        if (!isValid) {
            return new Response(JSON.stringify({
                success: false,
                message: '会话已过期'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const formData = await request.formData();
        const file = formData.get('file');
        const path = formData.get('path');
        const sha = formData.get('sha');
        
        if (!file || !path) {
            return new Response(JSON.stringify({
                success: false,
                message: '缺少必要参数'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const content = btoa(binary);
        
        const uploadData = {
            message: `Upload ${path}`,
            content: content
        };
        if (sha) {
            uploadData.sha = sha;
        }
        
        const response = await fetch(
            `https://api.github.com/repos/${GIT_REPO}/contents/${path}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(uploadData)
            }
        );
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '上传失败');
        }
        
        const result = await response.json();
        
        return new Response(JSON.stringify({
            success: true,
            data: result
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// 删除文件（支持文件和目录）
// ============================================================

async function handleDeleteFile(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({
                success: false,
                message: '未授权'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const token = authHeader.substring(7);
        const isValid = await validateToken(token, LOGIN_PASSWORD);
        if (!isValid) {
            return new Response(JSON.stringify({
                success: false,
                message: '会话已过期或无效'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const { path, sha, isDir } = await request.json();
        
        if (!path) {
            return new Response(JSON.stringify({
                success: false,
                message: '缺少路径参数'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // ============================================================
        // 删除目录
        // ============================================================
        if (isDir) {
            console.log('删除目录:', path);
            
            // 1. 先检查目录内容
            const listUrl = `https://api.github.com/repos/${GIT_REPO}/contents/${path}`;
            const listResponse = await fetch(listUrl, {
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker'
                }
            });
            
            // 如果目录不存在，直接返回成功
            if (!listResponse.ok) {
                return new Response(JSON.stringify({
                    success: true,
                    message: '目录已删除'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            const listData = await listResponse.json();
            
            // 检查是否有 .init 以外的文件
            if (Array.isArray(listData)) {
                const realFiles = listData.filter(f => f.name !== '.init');
                if (realFiles.length > 0) {
                    return new Response(JSON.stringify({
                        success: false,
                        message: '目录非空，请先删除目录内所有文件'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
            
            // 2. 获取 .init 文件的 SHA
            const initPath = path.endsWith('/') ? path + '.init' : path + '/.init';
            const initResponse = await fetch(
                `https://api.github.com/repos/${GIT_REPO}/contents/${initPath}`,
                {
                    headers: {
                        'Authorization': `token ${GIT_TOKEN}`,
                        'Accept': 'application/vnd.github+json',
                        'User-Agent': 'Cloudflare-Worker'
                    }
                }
            );
            
            // 如果没有 .init 文件，说明目录是空的或者不是通过工具创建的
            if (!initResponse.ok) {
                return new Response(JSON.stringify({
                    success: true,
                    message: '目录已删除'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            const initData = await initResponse.json();
            const initSha = initData.sha;
            
            // 3. 删除 .init 文件
            const deleteResponse = await fetch(
                `https://api.github.com/repos/${GIT_REPO}/contents/${initPath}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `token ${GIT_TOKEN}`,
                        'Accept': 'application/vnd.github+json',
                        'User-Agent': 'Cloudflare-Worker',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Delete directory ${path}`,
                        sha: initSha
                    })
                }
            );
            
            if (!deleteResponse.ok) {
                const error = await deleteResponse.json();
                throw new Error(error.message || '删除目录失败');
            }
            
            return new Response(JSON.stringify({
                success: true,
                message: '目录删除成功'
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // ============================================================
        // 删除文件
        // ============================================================
        if (!sha) {
            return new Response(JSON.stringify({
                success: false,
                message: '缺少文件 SHA'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 检查系统文件
        const systemFiles = ['index.html', 'D-file.html', 'CNAME', 'json.html'];
        const fileName = path.split('/').pop();
        if (systemFiles.includes(fileName)) {
            return new Response(JSON.stringify({
                success: false,
                message: '系统文件不能删除'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 删除文件
        const response = await fetch(
            `https://api.github.com/repos/${GIT_REPO}/contents/${path}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Delete ${path}`,
                    sha: sha
                })
            }
        );
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '删除失败');
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: '删除成功'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('删除失败:', error);
        return new Response(JSON.stringify({
            success: false,
            message: error.message || '删除失败'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
// ============================================================
// 创建目录
// ============================================================

async function handleMkdir(request, GIT_REPO, GIT_TOKEN, LOGIN_PASSWORD) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({
                success: false,
                message: '未授权'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const token = authHeader.substring(7);
        const isValid = await validateToken(token, LOGIN_PASSWORD);
        if (!isValid) {
            return new Response(JSON.stringify({
                success: false,
                message: '会话已过期'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const { path } = await request.json();
        
        if (!path) {
            return new Response(JSON.stringify({
                success: false,
                message: '缺少路径参数'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const initPath = path.endsWith('/') ? path + '.init' : path + '/.init';
        
        const response = await fetch(
            `https://api.github.com/repos/${GIT_REPO}/contents/${initPath}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GIT_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Cloudflare-Worker',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Create directory ${path}`,
                    content: ''
                })
            }
        );
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '创建目录失败');
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: '目录创建成功'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// 搜索文件
// ============================================================

async function handleSearchFiles(request, GIT_REPO, GIT_TOKEN) {
    try {
        const { keyword, path = '', maxDepth = 5 } = await request.json();
        
        const results = await searchFiles(keyword, path, 0, maxDepth, GIT_REPO, GIT_TOKEN);
        
        return new Response(JSON.stringify({
            success: true,
            data: results
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function searchFiles(keyword, path, depth, maxDepth, GIT_REPO, GIT_TOKEN) {
    if (depth > maxDepth) return [];
    let results = [];
    
    try {
        const url = path ? 
            `https://api.github.com/repos/${GIT_REPO}/contents/${path}` :
            `https://api.github.com/repos/${GIT_REPO}/contents`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${GIT_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Cloudflare-Worker'
            }
        });
        
        if (!response.ok) return results;
        
        const data = await response.json();
        if (!Array.isArray(data)) return results;
        
        for (const item of data) {
            const ignore = ['.', 'D-file.html', 'index.html', 'json.html'];
            if (ignore.includes(item.name)) continue;
            
            if (item.type === 'dir') {
                const sub = await searchFiles(keyword, item.path, depth + 1, maxDepth, GIT_REPO, GIT_TOKEN);
                results.push(...sub);
            } else if (item.name.toLowerCase().includes(keyword.toLowerCase())) {
                results.push({
                    name: item.name,
                    path: item.path,
                    size: item.size,
                    sha: item.sha,
                    type: 'file'
                });
            }
        }
    } catch (e) {
        console.warn('搜索错误:', e);
    }
    
    return results;
}

// ============================================================
// 配置信息
// ============================================================

function handleConfig(GIT_REPO) {
    return new Response(JSON.stringify({
        repo: GIT_REPO,
        hasToken: true
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// ============================================================
// 代理到 GitHub
// ============================================================

async function proxyToFile(request, GIT_REPO, GIT_TOKEN, pathname) {
    const filePath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
    
    try {
        const decodedPath = decodeURIComponent(filePath);
        const encodedPath = decodedPath.split('/').map(part => encodeURIComponent(part)).join('/');
        const apiUrl = `https://api.github.com/repos/${GIT_REPO}/contents/${encodedPath}?ref=main`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${GIT_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Cloudflare-Worker'
            }
        });
        
        if (!response.ok) {
            return new Response('文件未找到', { status: 404 });
        }
        
        const data = await response.json();
        
        if (Array.isArray(data)) {
            return new Response(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const content = new TextDecoder('utf-8').decode(bytes);
        
        const ext = filePath.split('.').pop().toLowerCase();
        const contentType = getContentType(ext);
        
        return new Response(content, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch (err) {
        return new Response('获取文件失败: ' + err.message, { status: 500 });
    }
}

// ============================================================
// HTML 页面 - 完整保留所有原始UI
// ============================================================

function handleAdminPanel() {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>黑猫文件 · D-File</title>
    <script src="https://cdn.bootcdn.net/ajax/libs/axios/1.1.3/axios.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/js-base64@3.7.5/base64.min.js"></script>
    <link rel="shortcut icon" type="image/x-icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAMxJREFUOE+t06FuAkEQxvH/FxpegUoeovXUoOobJLapRDaw2T1b21qwoNGUB8BW45jwDmQJENIj3F2vd0wyZjL7m2QmK2qGar7nCLSGsadIF2hfgOLTvGZFQ47A/Xt0iFFG45jI5Kp+x9acfg71v4Dc4YKHTdDqDHSAQ2ZFzKkvLdH3LyDegGYqixcsvHkt0sDiXxcRz+Y1rw7AiwVN6wB9CxpXB8SreX1VByIDS/RRBxhaonACXGyzYwo8lrzEmgZP5rS+zWcqOTWzbQ96PEURUT++WAAAAABJRU5ErkJggg==" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { background: #0a0a0a; color: #e0e0e0; padding: 0; }
        body { 
            font-size: 15px; 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 15px;
            height: 100vh;
            overflow: auto;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
        }
        body::-webkit-scrollbar {
            width: 8px;
        }
        body::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
        }
        body::-webkit-scrollbar-thumb {
            background: rgba(255, 144, 0, 0.6);
            border-radius: 4px;
        }
        
        .login-mask {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        .login-box {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 40px;
            width: 90%;
            max-width: 400px;
            border: 1px solid rgba(255, 144, 0, 0.3);
            box-shadow: 0 8px 32px rgba(255, 144, 0, 0.1);
        }
        .login-box h2 {
            color: #ff9000;
            margin-bottom: 30px;
            text-align: center;
            font-size: 24px;
        }
        .login-box input {
            width: 100%;
            padding: 12px 16px;
            margin: 10px 0;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #fff;
            font-size: 15px;
        }
        .login-box input:focus {
            outline: none;
            border-color: #ff9000;
        }
        .login-box button {
            width: 100%;
            padding: 12px;
            margin-top: 15px;
            background: linear-gradient(135deg, #ff9000, #ffb347);
            border: none;
            border-radius: 8px;
            color: #000;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        .login-box button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(255, 144, 0, 0.4);
        }
        
        #drop-zone {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .main-panel {
            flex: 1 0 auto;
            overflow: visible;
            display: flex;
            flex-direction: column;
            background: rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(10px);
            border-radius: 12px;
            padding: 15px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            margin: 0;
        }
        .main-panel::-webkit-scrollbar {
            width: 8px;
        }
        .main-panel::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
        }
        .main-panel::-webkit-scrollbar-thumb {
            background: rgba(255, 144, 0, 0.5);
            border-radius: 4px;
        }
        .main-panel::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 144, 0, 0.8);
        }
        
        .top-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .action-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 6px 10px;
            background: rgba(255, 144, 0, 0.1);
            border: 1px solid rgba(255, 144, 0, 0.3);
            border-radius: 6px;
            color: #ff9000;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            white-space: nowrap;
        }
        .action-btn:hover {
            background: rgba(255, 144, 0, 0.2);
            transform: translateY(-1px);
        }
        .action-btn.primary {
            background: linear-gradient(135deg, #ff9000, #ffb347);
            color: #000;
            border: none;
            font-weight: bold;
        }
        .action-btn.primary:hover {
            box-shadow: 0 4px 12px rgba(255, 144, 0, 0.4);
        }
        
        .cdn-section {
            margin-bottom: 12px;
            flex-shrink: 0;
        }
        .cdn-input-wrapper {
            margin-bottom: 10px;
        }
        .cdn-input-wrapper.hidden {
            display: none;
        }
        .cdn-input {
            width: 100%;
            padding: 10px 14px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            margin-bottom: 10px;
        }
        .cdn-input:focus {
            outline: none;
            border-color: #ff9000;
        }
        .cdn-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .cdn-btn {
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .cdn-btn:hover {
            border-color: #ff9000;
            color: #ff9000;
        }
        .cdn-btn.active {
            background: rgba(255, 144, 0, 0.2);
            border-color: #ff9000;
            color: #ff9000;
        }
        .speed-tag {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.1);
        }
        .speed-good { color: #4ade80; }
        .speed-slow { color: #f87171; }
        
        .file_wrap {
            flex: 1;
            overflow-y: visible;
            margin-top: 10px;
        }
        .file_list { 
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .file_list li {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            transition: all 0.2s;
            flex-wrap: nowrap;
        }
        .file_list li:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(255, 144, 0, 0.3);
        }
        .file_list li:before {
            content: "📄";
            font-size: 18px;
            min-width: 24px;
        }
        .file_list li.dir:before { content: "📁"; }
        .file_list li.img:before { content: "🖼️"; }
        .file_list li.video:before { content: "🎥"; }
        .file_list li.music:before { content: "🎵"; }
        .file_list li.code:before { content: "💻"; }
        .file_list li.zip:before { content: "📦"; }
        .file_list li.doc:before { content: "📝"; }
        .file_list li.xls:before { content: "📊"; }
        .file_list li.ppt:before { content: "📑"; }
        .file_list li.pdf:before { content: "📕"; }
        .file_list li.txt:before { content: "📃"; }
        .file_list li a {
            color: #e0e0e0;
            text-decoration: none;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 14px;
            min-width: 0;
        }
        .file_list li.dir a { 
            color: #ff9000; 
            font-weight: 600;
            text-decoration: underline;
        }
        .file_list li span { 
            color: #999; 
            font-size: 12px;
            white-space: nowrap;
        }
        .file_list li span.sha { 
            font-family: monospace;
            opacity: 0.6;
        }
        .file_list li span.size { 
            min-width: 60px;
            text-align: right;
        }
        .file_list li .delete-btn {
            padding: 4px 10px;
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid rgba(248, 113, 113, 0.3);
            border-radius: 6px;
            color: #f87171;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .file_list li .delete-btn:hover {
            background: rgba(248, 113, 113, 0.2);
        }
        
        .search-box {
            margin-left: auto;
            position: relative;
        }
        .search-box input {
            width: 200px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
        }
        .search-box input:focus {
            outline: none;
            border-color: #ff9000;
            width: 250px;
        }
        
        .drag-hint {
            background: rgba(255, 144, 0, 0.08);
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 15px;
            border: 2px dashed rgba(255, 144, 0, 0.3);
            color: #ff9000;
            text-align: center;
            font-size: 14px;
        }
        #drop-zone { transition: all 0.3s ease; }
        #drop-zone.dragover { 
            background: rgba(255, 144, 0, 0.15); 
            border-radius: 12px;
        }
        .empty-folder-hint {
            text-align: center;
            padding: 60px 20px;
            border: 2px dashed rgba(255, 144, 0, 0.3);
            border-radius: 12px;
            margin: 20px 0;
            background: rgba(255, 144, 0, 0.03);
        }
        
        #loading {
            position: fixed;
            width: 100vw;
            height: 100vh;
            left: 0;
            top: 0;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            color: #ff9000;
            z-index: 9999;
            font-size: 16px;
            gap: 15px;
        }
        .progress-bar {
            width: 300px;
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #ff9000, #ffb347);
            transition: width 0.3s ease;
            width: 0%;
        }
        .hide { display: none !important; }
        
        .modal-mask {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        }
        .config-modal {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 16px;
            width: 90%;
            max-width: 450px;
            padding: 30px;
            border: 1px solid rgba(255, 144, 0, 0.3);
            box-shadow: 0 8px 32px rgba(255, 144, 0, 0.2);
        }
        .config-modal h3 {
            margin-bottom: 20px;
            color: #ff9000;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .config-modal label {
            display: block;
            margin: 15px 0 8px;
            color: #e0e0e0;
            font-size: 14px;
            font-weight: 500;
        }
        .config-modal input {
            width: 100%;
            padding: 12px 14px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            transition: all 0.2s;
        }
        .config-modal input:focus {
            outline: none;
            border-color: #ff9000;
            background: rgba(255, 255, 255, 0.08);
        }
        .config-modal button {
            width: 100%;
            padding: 12px;
            margin-top: 20px;
            background: linear-gradient(135deg, #ff9000, #ffb347);
            border: none;
            border-radius: 8px;
            color: #000;
            font-size: 15px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        .config-modal button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(255, 144, 0, 0.4);
        }
        .close-modal {
            background: rgba(255, 255, 255, 0.1) !important;
            color: #fff !important;
            margin-top: 10px;
        }
        .close-modal:hover {
            background: rgba(255, 255, 255, 0.15) !important;
        }
        
        .theme-switcher {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .theme-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 2px solid rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: all 0.2s;
        }
        .theme-btn:hover {
            transform: scale(1.1);
            border-color: #ff9000;
        }
        .theme-btn.active {
            border-color: #ff9000;
            box-shadow: 0 0 8px rgba(255, 144, 0, 0.5);
        }
        
        body.theme-light { 
            background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
            color: #1a1a1a;
        }
        body.theme-light .main-panel {
            background: rgba(255, 255, 255, 0.95);
            border-color: rgba(0, 0, 0, 0.15);
        }
        body.theme-light .file_list li {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(0, 0, 0, 0.1);
            color: #1a1a1a;
        }
        body.theme-light .file_list li:hover {
            background: #ffffff;
            border-color: rgba(255, 144, 0, 0.5);
        }
        body.theme-light .file_list li a { color: #1a1a1a; }
        body.theme-light .file_list li.dir a { color: #ff9000; }
        body.theme-light .file_list li span { color: #666; }
        body.theme-light .file_list li .delete-btn {
            background: rgba(248, 113, 113, 0.15);
            border-color: rgba(248, 113, 113, 0.4);
            color: #dc2626;
        }
        body.theme-light .action-btn {
            background: rgba(255, 144, 0, 0.15);
            border-color: rgba(255, 144, 0, 0.4);
            color: #e67e00;
        }
        body.theme-light .cdn-btn {
            background: rgba(0, 0, 0, 0.05);
            border-color: rgba(0, 0, 0, 0.15);
            color: #333;
        }
        body.theme-light .cdn-input,
        body.theme-light .search-box input {
            background: rgba(255, 255, 255, 0.9);
            color: #1a1a1a;
            border-color: rgba(0, 0, 0, 0.2);
        }
        body.theme-light .drag-hint {
            background: rgba(255, 144, 0, 0.1);
            border-color: rgba(255, 144, 0, 0.4);
            color: #e67e00;
        }
        body.theme-light .empty-folder-hint {
            background: rgba(255, 144, 0, 0.05);
            border-color: rgba(255, 144, 0, 0.3);
        }
        body.theme-light .login-box {
            background: rgba(255, 255, 255, 0.95);
            border-color: rgba(255, 144, 0, 0.4);
        }
        body.theme-light .login-box input {
            background: rgba(0, 0, 0, 0.05);
            border-color: rgba(0, 0, 0, 0.15);
            color: #1a1a1a;
        }
        
        body.theme-blue {
            background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
            color: #e2e8f0;
        }
        body.theme-blue .main-panel {
            background: rgba(15, 23, 42, 0.8);
            border-color: rgba(59, 130, 246, 0.2);
        }
        body.theme-blue .file_list li {
            background: rgba(30, 41, 59, 0.6);
            border-color: rgba(59, 130, 246, 0.15);
            color: #e2e8f0;
        }
        body.theme-blue .action-btn {
            background: rgba(59, 130, 246, 0.15);
            border-color: rgba(59, 130, 246, 0.4);
            color: #60a5fa;
        }
        body.theme-blue .login-box {
            background: rgba(15, 23, 42, 0.9);
            border-color: rgba(59, 130, 246, 0.4);
        }
        body.theme-blue .login-box h2 { color: #60a5fa; }
        body.theme-blue .login-box button {
            background: linear-gradient(135deg, #3b82f6, #60a5fa);
        }
        
        body.theme-green {
            background: linear-gradient(135deg, #052e16 0%, #166534 100%);
            color: #ecfdf5;
        }
        body.theme-green .main-panel {
            background: rgba(5, 46, 22, 0.8);
            border-color: rgba(34, 197, 94, 0.2);
        }
        body.theme-green .action-btn {
            background: rgba(34, 197, 94, 0.15);
            border-color: rgba(34, 197, 94, 0.4);
            color: #4ade80;
        }
        body.theme-green .login-box {
            background: rgba(5, 46, 22, 0.9);
            border-color: rgba(34, 197, 94, 0.4);
        }
        body.theme-green .login-box h2 { color: #4ade80; }
        body.theme-green .login-box button {
            background: linear-gradient(135deg, #22c55e, #4ade80);
        }
        
        body.theme-purple {
            background: linear-gradient(135deg, #2e1065 0%, #6b21a8 100%);
            color: #faf5ff;
        }
        body.theme-purple .main-panel {
            background: rgba(46, 16, 101, 0.8);
            border-color: rgba(168, 85, 247, 0.2);
        }
        body.theme-purple .action-btn {
            background: rgba(168, 85, 247, 0.15);
            border-color: rgba(168, 85, 247, 0.4);
            color: #c084fc;
        }
        body.theme-purple .login-box {
            background: rgba(46, 16, 101, 0.9);
            border-color: rgba(168, 85, 247, 0.4);
        }
        body.theme-purple .login-box h2 { color: #c084fc; }
        body.theme-purple .login-box button {
            background: linear-gradient(135deg, #a855f7, #c084fc);
        }
        
        @media screen and (max-width: 768px) {
            body { padding: 10px; }
            .main-panel { padding: 10px; overflow: auto; -webkit-overflow-scrolling: touch; }
            .top-bar { gap: 4px; }
            .action-btn { padding: 5px 8px; font-size: 12px; gap: 3px; }
            .search-box { flex: 1; min-width: 0; }
            .search-box input { width: 100%; }
            .search-box input:focus { width: 100%; }
            .cdn-section { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
            .cdn-input-wrapper { flex: 1; margin-bottom: 0; }
            .cdn-buttons { flex-wrap: nowrap; overflow-x: auto; }
            .file_wrap { flex: 1; overflow-y: visible; }
            .file_list li { padding: 10px 12px; gap: 8px; }
            .file_list li span.sha, .file_list li span.size { display: none; }
            .file_list li a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .file_list li .delete-btn { padding: 6px 12px; font-size: 12px; min-width: 55px; flex-shrink: 0; }
            .cdn-btn, .action-btn { padding: 5px 8px; font-size: 12px; white-space: nowrap; }
        }
        
        @media screen and (max-width: 480px) {
            body { padding: 8px; }
            .main-panel { padding: 8px; }
            .login-box { padding: 25px 15px; }
            .file_wrap { flex: 1; overflow-y: visible; }
            .file_list li { padding: 8px 10px; font-size: 13px; gap: 6px; }
            .file_list li a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .file_list li .delete-btn { padding: 6px 12px; font-size: 11px; min-width: 55px; flex-shrink: 0; }
            .action-btn, .cdn-btn { padding: 4px 7px; font-size: 11px; }
        }
    </style>
</head>
<body>
<div id="login-screen" class="login-mask">
    <div class="login-box">
        <h2>🔐 黑猫文件管理系统</h2>
        <input type="password" id="login-pwd" placeholder="请输入访问密码" autocomplete="off" onkeypress="if(event.key==='Enter')handleLogin()" />
        <button onclick="handleLogin()">登录</button>
    </div>
</div>

<div id="drop-zone" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" style="display:none;">
    <div class="drag-hint">💡 支持拖拽上传：直接将文件拖放到页面任意位置即可上传</div>
    
    <div class="main-panel">
        <div class="top-bar">
            <span class="action-btn primary" onclick="addDir()">📁 新建目录</span>
            <span class="action-btn primary" onclick="document.getElementById('file').click()">📤 上传文件</span>
            <span class="action-btn" onclick="dirBack()">← 返回</span>
            <span class="action-btn" onclick="refresh()">🔄 刷新</span>
            <span class="action-btn" onclick="handleLogout()">🚪 退出</span>
            
            <div class="search-box">
                <input type="text" id="search" placeholder="🔍 全局搜索(回车)" onkeyup="globalSearch(event)" />
            </div>
            
            <div class="theme-switcher">
                <div class="theme-btn active" style="background: linear-gradient(135deg, #0a0a0a, #1a1a2e);" onclick="setTheme('', event)" title="深色"></div>
                <div class="theme-btn" style="background: linear-gradient(135deg, #f5f5f5, #e8e8e8);" onclick="setTheme('theme-light', event)" title="浅色"></div>
                <div class="theme-btn" style="background: linear-gradient(135deg, #0f172a, #1e3a8a);" onclick="setTheme('theme-blue', event)" title="蓝色"></div>
                <div class="theme-btn" style="background: linear-gradient(135deg, #052e16, #166534);" onclick="setTheme('theme-green', event)" title="绿色"></div>
                <div class="theme-btn" style="background: linear-gradient(135deg, #2e1065, #6b21a8);" onclick="setTheme('theme-purple', event)" title="紫色"></div>
            </div>
        </div>
        
        <div class="cdn-section">
            <div class="cdn-input-wrapper" id="cdn-input-wrapper">
                <input type="text" id="rootdm" class="cdn-input" placeholder="CDN地址 (点击下方按钮自动填充)" />
            </div>
            <div id="btn-wrap" class="cdn-buttons"></div>
        </div>
        
        <input type="file" id="file" multiple style="display:none;" />
        
        <div id="file_wrap">
            <ul class="file_list" id="file_list">加载中...</ul>
        </div>
    </div>
    
    <div id="loading" class="hide">
        <div>处理中...</div>
        <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
        </div>
    </div>
</div>

<script>
    // ============================================================
    // 前端代码 - 所有敏感操作通过 API 调用
    // ============================================================
    
    let sessionToken = '';
    let isLoggedIn = false;
    let baseRepo = '';
    let paths = [];
    let fileList = [];
    
    // 获取配置
    async function loadConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            baseRepo = config.repo;
            return config;
        } catch (error) {
            console.error('加载配置失败:', error);
            return null;
        }
    }
    
    // 登录
    async function handleLogin() {
        const pwd = document.getElementById('login-pwd').value;
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            
            const result = await response.json();
            
            if (result.success) {
                sessionToken = result.token;
                isLoggedIn = true;
                document.getElementById('login-screen').classList.add('hide');
                document.getElementById('drop-zone').style.display = 'block';
                await loadConfig();
                initApp();
            } else {
                alert('密码错误');
                document.getElementById('login-pwd').value = '';
            }
        } catch (error) {
            alert('登录失败: ' + error.message);
        }
    }
    
    function handleLogout() {
        if(confirm('确认退出？')) {
            isLoggedIn = false;
            sessionToken = '';
            location.reload();
        }
    }
    
    function setTheme(themeName, event) {
        const themes = ['theme-light', 'theme-blue', 'theme-green', 'theme-purple'];
        document.body.classList.remove(...themes);
        if(themeName) document.body.classList.add(themeName);
        localStorage.setItem('dfile_theme', themeName);
        document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
        if(event && event.target) event.target.classList.add('active');
    }
    
    const savedTheme = localStorage.getItem('dfile_theme');
    if(savedTheme) {
        setTimeout(() => {
            document.body.classList.add(savedTheme);
            document.querySelectorAll('.theme-btn').forEach(btn => {
                btn.classList.remove('active');
                if(btn.getAttribute('onclick').includes(savedTheme)) {
                    btn.classList.add('active');
                }
            });
        }, 100);
    }
    
    // 验证管理员密码
    async function verifyPassword() {
        return new Promise((resolve) => {
            const modalDiv = document.createElement('div');
            modalDiv.className = 'modal-mask';
            modalDiv.innerHTML = \`
                <div class="config-modal">
                    <h3>🔐 身份验证</h3>
                    <input type="password" id="pwdInput" placeholder="管理员密码" autocomplete="off" />
                    <button id="submitPwdBtn">确认</button>
                    <button id="cancelPwdBtn" class="close-modal">取消</button>
                </div>
            \`;
            document.body.appendChild(modalDiv);
            const input = modalDiv.querySelector('#pwdInput');
            const submitBtn = modalDiv.querySelector('#submitPwdBtn');
            const cancelBtn = modalDiv.querySelector('#cancelPwdBtn');
            const verify = async () => {
                try {
                    const response = await fetch('/api/auth/verify-admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: input.value })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        modalDiv.remove();
                        resolve(true);
                    } else {
                        alert("密码错误");
                        input.value = '';
                        input.focus();
                    }
                } catch (error) {
                    alert("验证失败: " + error.message);
                }
            };
            submitBtn.onclick = verify;
            cancelBtn.onclick = () => { modalDiv.remove(); resolve(false); };
            input.addEventListener('keypress', (e) => { if(e.key === 'Enter') verify(); });
            input.focus();
        });
    }
    
    function getAuthHeader() {
        return { 'Authorization': 'Bearer ' + sessionToken };
    }
    
    // API 请求封装
    async function apiRequest(endpoint, data) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || '请求失败');
        }
        return result;
    }
    
    // CDN 测速
    async function testCDNSpeed(url, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const start = performance.now();
        try {
            const testUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
            await fetch(testUrl, { method: 'HEAD', signal: controller.signal, mode: 'no-cors', cache: 'no-store' });
            clearTimeout(timeoutId);
            return Math.round(performance.now() - start);
        } catch(e) {
            clearTimeout(timeoutId);
            return null;
        }
    }
    
    let urls = [];
    function rebuildUrls() {
        urls = [
            { name: "本站", url: location.origin + location.pathname.replace(/\\/[^/]*$/, '/') },
            { name: "jsDelivr", url: \`https://cdn.jsdelivr.net/gh/\${baseRepo}/\` },
            { name: "gcore", url: \`https://gcore.jsdelivr.net/gh/\${baseRepo}@master/\` },
            { name: "gh-proxy", url: \`https://gh-proxy.com/https://raw.githubusercontent.com/\${baseRepo}/master/\` },
            { name: "fxxk", url: \`https://github.fxxk.dedyn.io/https://raw.githubusercontent.com/\${baseRepo}/master/\` }
        ];
    }
    
    async function initBtn() {
        if(!baseRepo) return;
        rebuildUrls();
        let btnEl = document.getElementById("btn-wrap");
        btnEl.innerHTML = '';
        
        for(let j = 0; j < urls.length; j++) {
            const temp = urls[j];
            const btn = document.createElement("button");
            btn.className = 'cdn-btn';
            btn.innerHTML = \`<span class="cdn-name">\${temp.name}</span><span class="speed-tag" id="btn\${j}">⏳</span>\`;
            btn.onclick = function () {
                btnEl.querySelectorAll('.cdn-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById("rootdm").value = temp.url;
                const inputWrapper = document.getElementById('cdn-input-wrapper');
                if(j === 0) {
                    inputWrapper.classList.add('hidden');
                } else {
                    inputWrapper.classList.remove('hidden');
                }
                initFileList();
            };
            btnEl.appendChild(btn);
            
            if(j === 0) {
                btn.classList.add('active');
                document.getElementById("rootdm").value = temp.url;
            }
            
            testCDNSpeed(temp.url).then(speed => {
                const speedEl = document.getElementById(\`btn\${j}\`);
                if(speedEl) {
                    if(speed !== null && speed < 3000) {
                        speedEl.innerHTML = speed + "ms";
                        speedEl.className = "speed-tag speed-good";
                    } else if(speed !== null) {
                        speedEl.innerHTML = speed + "ms";
                        speedEl.className = "speed-tag speed-slow";
                    } else {
                        speedEl.innerHTML = "超时";
                        speedEl.className = "speed-tag speed-slow";
                    }
                }
            });
        }
        
        document.getElementById('cdn-input-wrapper').classList.add('hidden');
    }
    
    // 获取目录
    async function getDir(path, isRoot, event, isBack) {
        if (!path && !isRoot) return;
        if (event) event.preventDefault();
        showLoading();
        try {
            const result = await apiRequest('/api/files/list', { path: path || '' });
            fileList = (result.data || [])
                .filter(d => !["init.jpg", "CNAME", "D-file.html", "index.html", "json.html", ".init"].includes(d.name))
                .map(item => { item.ftype = getType(item.name); if (item.type == "dir") item.ftype = "dir"; return item; });
            fileList.sort((a, b) => (a.type < b.type ? -1 : 1));
            if (path && !isBack) {
                if(!paths.length || paths[paths.length-1] !== path) paths.push(path);
            }
            initFileList();
            hideLoading();
        } catch(error) {
            if(!isRoot && !isBack && paths.length) paths.pop();
            hideLoading();
            alert('获取目录失败: ' + error.message);
        }
    }
    
    function initFileList(searchVal) {
        let rootdm = document.getElementById("rootdm").value || "";
        let tempList = fileList;
        if (searchVal && searchVal.trim()) {
            tempList = fileList.filter(item => item.name.includes(searchVal.trim()));
        }
        if (fileList.length) {
            document.getElementById("file_list").innerHTML = tempList.map(item => {
                const encodedPath = item.path.replace(/ /g, '%20');
                if(item.type === "dir") {
                    return \`<li class="file \${item.ftype}">
                        <a href="#" onclick="getDir('\${item.path}', false, event); return false;">\${escapeHtml(item.name)}</a>
                        <span class='sha'>\${item.sha?.slice(0,7) || ''}</span>
                        <span class="size">\${getUnit(item.size)}</span>
                        <button class="delete-btn" onclick="delOne('\${item.path.replace(/'/g, "\\\\'")}', '\${item.sha}')">删除</button>
                    </li>\`;
                } else {
                    const fileUrl = rootdm ? \`\${rootdm}\${encodedPath}\` : \`\${location.origin}\${location.pathname.replace(/\\/[^/]*$/, '/')}\${encodedPath}\`;
                    return \`<li class="file \${item.ftype}">
                        <a target="_blank" href="\${fileUrl}">\${escapeHtml(item.name)}</a>
                        <span class='sha'>\${item.sha?.slice(0,7) || ''}</span>
                        <span class="size">\${getUnit(item.size)}</span>
                        <button class="delete-btn" onclick="delOne('\${item.path.replace(/'/g, "\\\\'")}', '\${item.sha}')">删除</button>
                    </li>\`;
                }
            }).join("");
        } else {
            document.getElementById("file_list").innerHTML = \`<div class="empty-folder-hint"><p style="font-size:48px;">📁</p><p style="margin-top:15px;">当前文件夹为空</p><p style="margin-top:10px; font-size:14px; color:#999;">拖放文件到这里上传，或点击"上传文件"按钮</p></div>\`;
        }
    }
    
    function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); }
    
    function addDir() { 
        const val = prompt("请输入新建目录名称", ""); 
        if(val) {
            showLoading('创建目录中...');
            const targetPath = paths.length ? paths[paths.length-1] + '/' + val : val;
            apiRequest('/api/files/mkdir', { path: targetPath })
                .then(() => {
                    showLoading("✅ 创建成功: " + val);
                    setTimeout(() => { refresh(); hideLoading(); }, 1500);
                })
                .catch(err => {
                    hideLoading();
                    alert('创建目录失败: ' + err.message);
                });
        }
    }
    
    function dirBack() { 
        if(!paths.length) return alert("已经是根目录了!"); 
        paths.pop(); 
        getDir(paths.length ? paths[paths.length-1] : "", true, null, true); 
    }
    
    function refresh() { 
        const currentPath = paths.length ? paths[paths.length-1] : "";
        paths = [];
        if(currentPath) paths.push(currentPath);
        getDir(currentPath, true, null, true); 
    }
    
    function delOne(path, sha) {
        if(path == "index.html" || path == "D-file.html" || path == "CNAME" || path == "json.html") return alert("系统文件不能删除!");
        if(confirm("确认删除: " + path)) {
            verifyPassword().then(ok => {
                if(!ok) return;
                showLoading("删除中...");
                const isDir = fileList.find(f => f.path === path && f.type === "dir");
                apiRequest('/api/files/delete', { path, sha, isDir: !!isDir })
                    .then(() => {
                        showLoading("✅ 删除成功: " + path);
                        setTimeout(() => { refresh(); hideLoading(); }, 1500);
                    })
                    .catch(err => {
                        hideLoading();
                        alert('删除失败: ' + err.message);
                    });
            });
        }
    }
    
    document.getElementById("file").addEventListener("change", (e) => {
        const files = Array.from(e.target.files);
        const uploadPromises = files.map(file => {
            const targetPath = paths.length ? paths[paths.length-1] + "/" + file.name : file.name;
            return uploadFile(targetPath, file);
        });
        Promise.allSettled(uploadPromises).then(() => {
            refresh();
        });
        document.getElementById("file").value = "";
    });
    
    async function uploadFile(path, file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', path);
        
        // 检查文件是否存在
        try {
            const result = await apiRequest('/api/files/list', { path });
            if (result.data && result.data.sha) {
                if (!confirm(\`文件已存在: \${path}, 是否覆盖?\`)) {
                    throw new Error('取消覆盖');
                }
                formData.append('sha', result.data.sha);
            }
        } catch (e) {
            // 文件不存在，继续上传
        }
        
        try {
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getAuthHeader(),
                body: formData
            });
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || '上传失败');
            }
            return result;
        } catch (error) {
            throw new Error('上传失败: ' + error.message);
        }
    }
    
    function handleDrop(e) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('drop-zone').classList.remove('dragover');
        const files = e.dataTransfer.files;
        if(files.length === 0) return;
        
        showLoading(\`上传 \${files.length} 个文件...\`);
        updateProgress(0);
        let processed = 0;
        let failed = 0;
        
        const uploadPromises = Array.from(files).map(async (file) => {
            const targetPath = paths.length ? paths[paths.length-1] + "/" + file.name : file.name;
            try {
                await uploadFile(targetPath, file);
                processed++;
                updateProgress((processed / files.length) * 100);
                showLoading(\`上传中 \${processed}/\${files.length}\`);
            } catch (err) {
                failed++;
                processed++;
                updateProgress((processed / files.length) * 100);
                console.error(err);
                showLoading(\`上传中 \${processed}/\${files.length} (失败: \${failed})\`);
            }
        });
        
        Promise.allSettled(uploadPromises).then(() => {
            updateProgress(100);
            const successMsg = "✅ 上传完成：成功 " + (files.length - failed) + "/" + files.length + "，失败 " + failed + "/" + files.length;
            showLoading(successMsg);
            setTimeout(() => {
                refresh(); 
                hideLoading();
            }, 2000);
        });
    }
    
    function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('drop-zone').classList.add('dragover'); }
    function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('drop-zone').classList.remove('dragover'); }
    
    // 搜索
    async function searchAllFiles(keyword, path = "", depth = 0, maxDepth = 5) {
        try {
            const result = await apiRequest('/api/files/search', {
                keyword,
                path,
                maxDepth
            });
            return result.data || [];
        } catch (error) {
            console.warn('搜索失败:', error);
            return [];
        }
    }
    
    async function globalSearch(e) {
        if(e.keyCode == 13 || e.type === 'search') {
            const keyword = document.getElementById("search").value.trim();
            if(!keyword) { refresh(); return; }
            if(!baseRepo) { alert("请先配置仓库"); return; }
            showLoading("全局搜索中...");
            try {
                const results = await searchAllFiles(keyword);
                if(results.length === 0) {
                    document.getElementById("file_list").innerHTML = \`<div class="empty-folder-hint">🔍 未找到包含 "\${keyword}" 的文件</div>\`;
                } else {
                    let rootdm = document.getElementById("rootdm").value || "";
                    document.getElementById("file_list").innerHTML = results.map(item => {
                        const encodedPath = item.path.replace(/ /g, '%20');
                        const fileUrl = rootdm ? \`\${rootdm}\${encodedPath}\` : \`\${location.origin}\${location.pathname.replace(/\\/[^/]*$/, '/')}\${encodedPath}\`;
                        return \`<li class="file">
                            <a target="_blank" href="\${fileUrl}">\${escapeHtml(item.name)}</a>
                            <span class='sha'>\${item.sha?.slice(0,7) || ''}</span>
                            <span class="size">\${getUnit(item.size)}</span>
                            <span style="color:#666; font-size:12px; flex:1;">📁 \${item.path}</span>
                            <button class="delete-btn" onclick="delOne('\${item.path.replace(/'/g, "\\\\'")}', '\${item.sha}')">删除</button>
                        </li>\`;
                    }).join("");
                }
            } catch(err) { alert("搜索失败: " + err.message); }
            hideLoading();
        }
    }
    
    function getType(val) {
        if(/\\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(val)) return "img";
        if(/\\.(mp4|avi|mov|wmv|flv|mkv|webm)$/i.test(val)) return "video";
        if(/\\.(mp3|wav|wma|aac|flac|ogg)$/i.test(val)) return "music";
        if(/\\.(doc|docx|odt|rtf)$/i.test(val)) return "doc";
        if(/\\.(xls|xlsx|csv)$/i.test(val)) return "xls";
        if(/\\.(ppt|pptx|odp)$/i.test(val)) return "ppt";
        if(/\\.pdf$/i.test(val)) return "pdf";
        if(/\\.(txt|ini|properties|yml|yaml|json|md|log|cfg|conf)$/i.test(val)) return "txt";
        if(/\\.(java|html|htm|css|js|php|h|go|py|rb|rs|cpp|c|sh|sql|xml|vue|ts|jsx|tsx)$/i.test(val)) return "code";
        if(/\\.(zip|rar|7z|tar\\.gz|tar|bz2|gz)$/i.test(val)) return "zip";
        return "other";
    }
    
    function getUnit(bytes, decimals=1) { if(bytes===0) return "0B"; const k=1024,i=Math.floor(Math.log(bytes)/Math.log(k)); return parseFloat((bytes/Math.pow(k,i)).toFixed(decimals)) + ["B","KB","MB","GB","TB"][i]; }
    
    function showLoading(val) { 
        const loadingEl = document.getElementById("loading");
        loadingEl.innerHTML = \`
            <div>\${val || "处理中..."}</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress-fill"></div>
            </div>
        \`;
        loadingEl.className = "";
    }
    
    function updateProgress(percent) {
        const fill = document.getElementById('progress-fill');
        if(fill) fill.style.width = percent + '%';
    }
    
    function hideLoading() { document.getElementById("loading").className = "hide"; }
    
    async function initApp() {
        if (baseRepo) {
            await initBtn();
            getDir("", true);
        } else {
            document.getElementById("file_list").innerHTML = '<div class="empty-folder-hint">⚙️ 请配置仓库信息</div>';
        }
    }
    
    // 初始化
    loadConfig().then(() => {
        // 页面加载完成
    });
</script>
</body>
</html>`;

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
    });
}
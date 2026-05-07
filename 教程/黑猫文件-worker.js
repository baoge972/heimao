export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        
        // 调试：检查环境变量
        if(pathname === '/debug-env') {
            return new Response(JSON.stringify({
                GIT_REPO: env.GIT_REPO ? '已设置 (' + env.GIT_REPO + ')' : '未设置',
                GIT_TOKEN: env.GIT_TOKEN ? '已设置 (长度:' + env.GIT_TOKEN.length + ')' : '未设置',
                LOGIN_PASSWORD: env.LOGIN_PASSWORD ? '已设置' : '未设置',
                ADMIN_PASSWORD_HASH: env.ADMIN_PASSWORD_HASH ? '已设置 (长度:' + env.ADMIN_PASSWORD_HASH.length + ')' : '未设置',
                PASSWORD_SALT: env.PASSWORD_SALT ? '已设置' : '未设置'
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 从环境变量读取密码（运行时安全注入）
        const LOGIN_PASSWORD = env.LOGIN_PASSWORD || "baoge";
        const ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH || "d0c53f565930885c93a1b6193de1835a5bd6fb85df14bf55f797b8364fc298cc";
        const PASSWORD_SALT = env.PASSWORD_SALT || "D-File-2024-Secure";
        const GIT_REPO = env.GIT_REPO || "baoge972/heimao";
        const GIT_TOKEN = env.GIT_TOKEN || "";
        
        // 如果是根路径或管理面板路径，返回 HTML
        if(pathname === '/' || pathname === '/index.html' || pathname === '/D-file.html') {
            return handleAdminPanel(request, env, LOGIN_PASSWORD, ADMIN_PASSWORD_HASH, PASSWORD_SALT, GIT_REPO, GIT_TOKEN);
        }
        
        // 其他路径：代理到 GitHub 仓库文件
        return proxyToFile(request, env, pathname);
    }
};

// 代理到 GitHub 仓库文件
async function proxyToFile(request, env, pathname) {
    // 优先从环境变量读取，否则使用默认值
    const repo = env.GIT_REPO || "baoge972/heimao"; 
    const token = env.GIT_TOKEN || "";
    
    // 调试日志
    console.log('GIT_REPO:', repo);
    console.log('GIT_TOKEN:', token ? '已设置 (长度:' + token.length + ')' : '未设置');
    console.log('env 对象所有键:', Object.keys(env));
    
    if(!token) {
        return new Response('配置错误：GIT_TOKEN 未设置', { status: 500 });
    }
    
    // 移除开头的 /
    const filePath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
    
    try {
        // 先解码再编码，避免双重编码问题
        const decodedPath = decodeURIComponent(filePath);
        const encodedPath = decodedPath.split('/').map(part => encodeURIComponent(part)).join('/');
        // 明确指定 main 分支
        const apiUrl = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=main`;
        console.log('请求 GitHub API:', apiUrl);
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Cloudflare-Worker'
            }
        });
        
        console.log('GitHub 响应状态:', response.status);
        
        if(!response.ok) {
            const errorBody = await response.json().catch(() => response.text());
            const errorMsg = typeof errorBody === 'object' ? JSON.stringify(errorBody) : errorBody;
            console.error('GitHub API 错误详情:', errorMsg);
            return new Response('文件未找到\n\n路径: ' + filePath + '\nGitHub 状态: ' + response.status + '\nGitHub 返回: ' + errorMsg, { 
                status: 404,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
        
        const data = await response.json();
        
        // 如果是目录，返回目录列表
        if(Array.isArray(data)) {
            const fileList = data.map(item => ({
                name: item.name,
                path: item.path,
                type: item.type,
                size: item.size
            }));
            return new Response(JSON.stringify(fileList), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 如果是文件，解码 Base64 内容（支持 UTF-8 中文）
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for(let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const content = new TextDecoder('utf-8').decode(bytes);
        
        // 根据文件扩展名设置 Content-Type
        const ext = filePath.split('.').pop().toLowerCase();
        const contentType = getContentType(ext);
        
        return new Response(content, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch(err) {
        return new Response('获取文件失败: ' + err.message, { status: 500 });
    }
}

// 获取文件 Content-Type
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

// 返回管理面板 HTML
async function handleAdminPanel(request, env, LOGIN_PASSWORD, ADMIN_PASSWORD_HASH, PASSWORD_SALT, GIT_REPO, GIT_TOKEN) {
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
            overflow: hidden;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
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
            height: calc(100vh - 30px);
            display: flex;
            flex-direction: column;
        }
        .main-panel {
            flex: 1;
            overflow: hidden;
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
            overflow-y: auto;
            margin-top: 10px;
        }
        .file_list { 
            list-style: none;
            display: grid;
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
            .main-panel { padding: 10px; }
            .top-bar { gap: 4px; }
            .action-btn { padding: 5px 8px; font-size: 12px; gap: 3px; }
            .search-box { flex: 1; min-width: 0; }
            .search-box input { width: 100%; }
            .search-box input:focus { width: 100%; }
            .cdn-section { display: flex; gap: 6px; align-items: center; }
            .cdn-input-wrapper { flex: 1; margin-bottom: 0; }
            .cdn-buttons { flex-wrap: nowrap; overflow-x: auto; }
            .file_list li { padding: 10px 12px; gap: 8px; }
            .file_list li span.sha, .file_list li span.size { display: none; }
            .cdn-btn, .action-btn { padding: 5px 8px; font-size: 12px; white-space: nowrap; }
        }
        
        @media screen and (max-width: 480px) {
            body { padding: 8px; }
            .main-panel { padding: 8px; }
            .login-box { padding: 25px 15px; }
            .file_list li { padding: 8px 10px; font-size: 13px; gap: 6px; }
            .file_list li .delete-btn { padding: 4px 8px; font-size: 11px; }
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
    // ========== 环境变量注入（Workers 运行时注入） ==========
    const LOGIN_PASSWORD = "${LOGIN_PASSWORD}";
    const ADMIN_PASSWORD_HASH = "${ADMIN_PASSWORD_HASH}";
    const PASSWORD_SALT = "${PASSWORD_SALT}";
    const GIT_REPO = "${GIT_REPO}";
    const GIT_TOKEN = "${GIT_TOKEN}";
    
    // 自动配置仓库和 Token（从环境变量注入）
    if(GIT_REPO) {
        window.baseRepo = GIT_REPO;
    }
    if(GIT_TOKEN) {
        window.baseToken = GIT_TOKEN;
    }
    
    let isLoggedIn = false;
    
    function handleLogin() {
        const pwd = document.getElementById('login-pwd').value;
        if(pwd === LOGIN_PASSWORD) {
            isLoggedIn = true;
            document.getElementById('login-screen').classList.add('hide');
            document.getElementById('drop-zone').style.display = 'block';
            initApp();
        } else {
            alert('密码错误');
            document.getElementById('login-pwd').value = '';
        }
    }
    
    function handleLogout() {
        if(confirm('确认退出？')) {
            isLoggedIn = false;
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
    
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(PASSWORD_SALT + message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const CORRECT_PASSWORD_HASH = ADMIN_PASSWORD_HASH;
    
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
                const hashed = await sha256(input.value);
                if (hashed === CORRECT_PASSWORD_HASH) {
                    modalDiv.remove();
                    resolve(true);
                } else {
                    alert("密码错误");
                    input.value = '';
                    input.focus();
                }
            };
            submitBtn.onclick = verify;
            cancelBtn.onclick = () => { modalDiv.remove(); resolve(false); };
            input.addEventListener('keypress', (e) => { if(e.key === 'Enter') verify(); });
            input.focus();
        });
    }
    
    function getSecureToken() {
        return GIT_TOKEN;
    }
    
    if (!GIT_TOKEN || !GIT_REPO) {
        document.getElementById("file_list").innerHTML = '<div class="empty-folder-hint">⚠️ 环境变量未配置，请在 Dashboard 设置 GIT_REPO 和 GIT_TOKEN</div>';
    }
    
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
    
    window.request = axios.create({
        baseURL: "https://api.github.com/",
        timeout: 15000,
        headers: { Authorization: "Bearer " + baseToken, Accept: "application/vnd.github+json" }
    });
    request.interceptors.response.use(res => { hideLoading(); return res; }, err => { hideLoading(); return Promise.reject(err); });
    
    window.paths = [];
    window.en = Base64.encode;
    window.de = Base64.decode;
    window.fileList = [];
    
    async function searchAllFiles(keyword, path = "", depth = 0, maxDepth = 5) {
        if(depth > maxDepth) return [];
        let results = [];
        try {
            const url = path ? \`/repos/\${baseRepo}/contents/\${path}\` : \`/repos/\${baseRepo}/contents\`;
            const res = await request.get(url + "?t=" + Date.now());
            if(!Array.isArray(res.data)) return results;
            for(const item of res.data) {
                if(item.name.startsWith('.') || ["D-file.html", "index.html", "json.html"].includes(item.name)) continue;
                if(item.type === "dir") {
                    const sub = await searchAllFiles(keyword, item.path, depth + 1, maxDepth);
                    results.push(...sub);
                } else if(item.name.toLowerCase().includes(keyword.toLowerCase())) {
                    results.push({ name: item.name, path: item.path, size: item.size, sha: item.sha, type: "file" });
                }
            }
        } catch(e) { console.warn(e); }
        return results;
    }
    
    async function globalSearch(e) {
        if(e.keyCode == 13 || e.type === 'search') {
            const keyword = document.getElementById("search").value.trim();
            if(!keyword) { refresh(); return; }
            if(!baseRepo || !baseToken) { alert("请先配置仓库和Token"); return; }
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
    
    function initFileList(searchVal) {
        let rootdm = document.getElementById("rootdm").value || "";
        let tempList = window.fileList;
        if (searchVal && searchVal.trim()) {
            tempList = window.fileList.filter(item => item.name.includes(searchVal.trim()));
        }
        if (window.fileList.length) {
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
    
    function getDir(path, isRoot, event, isBack) {
        if (!path && !isRoot) return;
        if (event) event.preventDefault();
        showLoading();
        getContent(path + "?t=" + new Date().getTime()).then((data) => {
            window.fileList = (data || [])
                .filter(d => !["init.jpg", "CNAME", "D-file.html", "index.html", "json.html", ".init"].includes(d.name))
                .map(item => { item.ftype = getType(item.name); if (item.type == "dir") item.ftype = "dir"; return item; });
            window.fileList.sort((a, b) => (a.type < b.type ? -1 : 1));
            if (path && !isBack) {
                if(!paths.length || paths[paths.length-1] !== path) paths.push(path);
            }
            initFileList();
            hideLoading();
        }).catch(() => {
            if(!isRoot && !isBack && paths.length) paths.pop();
            hideLoading();
        });
    }
    
    function addDir() { const val = prompt("请输入新建目录名称", ""); if(val) putDir(val); }
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
                const isDir = window.fileList.find(f => f.path === path && f.type === "dir");
                if(isDir) {
                    getContent(path).then(dirContent => {
                        if(!Array.isArray(dirContent) || dirContent.length === 0) {
                            hideLoading();
                            alert("目录为空，已自动清理");
                            return;
                        }
                        const realFiles = dirContent.filter(f => f.name !== ".init");
                        if(realFiles.length > 0) {
                            hideLoading();
                            alert("目录非空，请先删除目录内所有文件");
                            return;
                        }
                        getSha(path + "/.init").then(initSha => {
                            if(initSha) {
                                delFile(path + "/.init", initSha, true);
                            } else {
                                hideLoading();
                                alert("删除失败：未找到目录标识文件");
                            }
                        });
                    });
                } else {
                    delFile(path, sha, true);
                }
            });
        }
    }
    
    document.getElementById("file").addEventListener("change", (e) => {
        Array.from(e.target.files).forEach(file => {
            putFile(paths.length ? paths[paths.length-1] + "/" + file.name : file.name, file);
        });
        document.getElementById("file").value = "";
    });
    
    function getSha(path) { return new Promise(reso => request.get(\`/repos/\${baseRepo}/contents/\${path}\`).then(res => reso(res.data.sha)).catch(() => reso(null))); }
    function getContent(path) { return new Promise(reso => request.get(\`/repos/\${baseRepo}/contents/\${path}\`).then(res => Array.isArray(res.data) ? reso(res.data) : reso(Base64.decode(res.data.content))).catch(() => reso(null))); }
    
    function putDir(path) {
        const data = { message: now() + " create dir " + path, content: "" };
        getContent(path).then(res => {
            if(Array.isArray(res)) return alert("目录已存在");
            const initPath = path + (path.endsWith("/") ? "" : "/") + ".init";
            request.put('/repos/' + baseRepo + '/contents/' + initPath, data).then(() => {
                showLoading("✅ 创建成功: " + path);
                setTimeout(() => {
                    refresh();
                    hideLoading();
                }, 1500);
            });
        });
    }
    
    function delFile(path, sha, isTip) {
        request.delete('/repos/' + baseRepo + '/contents/' + path, { params: { message: now() + " del " + path, sha } }).then(() => {
            if(isTip) {
                showLoading("✅ 删除成功: " + path);
                setTimeout(() => {
                    refresh();
                    hideLoading();
                }, 1500);
            } else {
                refresh();
            }
        }).catch(err => {
            hideLoading();
            alert("删除失败: " + (err.message || "未知错误"));
        });
    }
    
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    
    class UploadQueue {
        constructor(concurrency = 3) { 
            this.queue = []; 
            this.running = 0; 
            this.concurrency = concurrency; 
            this.results = []; 
        }
        add(file, targetPath) { 
            return new Promise((resolve, reject) => { 
                if(file.size > MAX_FILE_SIZE) {
                    const errorMsg = \`文件过大: \${file.name} (\${getUnit(file.size)})，最大支持 \${getUnit(MAX_FILE_SIZE)}\`;
                    alert(errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }
                this.queue.push({file, targetPath, resolve, reject, retries: 0}); 
                this.processNext(); 
            }); 
        }
        async processNext() {
            if(this.running >= this.concurrency || this.queue.length === 0) return;
            this.running++; 
            const task = this.queue.shift();
            try { 
                await this.uploadFile(task.file, task.targetPath); 
                this.results.push({ success: true, file: task.file.name }); 
                task.resolve(); 
            }
            catch(error) { 
                if(task.retries < 3) { 
                    this.queue.push({...task, retries: task.retries+1}); 
                } else { 
                    this.results.push({ success: false, file: task.file.name, error }); 
                    task.reject(error); 
                } 
            }
            finally { 
                this.running--; 
                this.processNext(); 
            }
        }
        async uploadFile(file, targetPath) {
            const sha = await getSha(targetPath);
            if(sha && !confirm(\`文件已存在: \${targetPath}, 是否覆盖?\`)) throw new Error('取消覆盖');
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsArrayBuffer(file);
                reader.onload = async () => {
                    try {
                        const uint8 = new Uint8Array(reader.result);
                        let binary = '';
                        for(let i=0;i<uint8.length;i+=8000) binary += String.fromCharCode(...uint8.slice(i, i+8000));
                        await request.put(\`/repos/\${baseRepo}/contents/\${targetPath}\`, { message: now() + " update " + targetPath, content: btoa(binary), sha });
                        resolve();
                    } catch(err) { reject(err); }
                };
                reader.onerror = reject;
            });
        }
        getResults() { return this.results; }
    }
    
    function handleDrop(e) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('drop-zone').classList.remove('dragover');
        const files = e.dataTransfer.files;
        if(files.length === 0) return;
        const uploadQueue = new UploadQueue(3);
        showLoading(\`上传 \${files.length} 个文件...\`);
        updateProgress(0);
        let processed = 0;
        let failed = 0;
        const promises = Array.from(files).map(file => {
            const targetPath = paths.length ? paths[paths.length-1] + "/" + file.name : file.name;
            return uploadQueue.add(file, targetPath).then(() => { 
                processed++; 
                updateProgress((processed / files.length) * 100);
                showLoading(\`上传中 \${processed}/\${files.length}\`); 
            }).catch(err => { 
                failed++;
                processed++;
                updateProgress((processed / files.length) * 100);
                console.error(err);
                showLoading(\`上传中 \${processed}/\${files.length} (失败: \${failed})\`); 
            });
        });
        Promise.allSettled(promises).then(() => {
            updateProgress(100);
            const results = uploadQueue.getResults();
            const successful = results.filter(r => r.success).length;
            const successMsg = "\u2705 上传完成：成功 " + successful + "/" + files.length + "，失败 " + failed + "/" + files.length;
            showLoading(successMsg);
            setTimeout(() => {
                refresh(); 
                hideLoading();
            }, 2000);
        });
    }
    
    function putFile(path, file) {
        if(file.size > MAX_FILE_SIZE) {
            alert(\`文件过大: \${file.name} (\${getUnit(file.size)})，最大支持 \${getUnit(MAX_FILE_SIZE)}\`);
            return;
        }
        const uploadQueue = new UploadQueue(1);
        showLoading(\`上传: \${path}\`);
        updateProgress(0);
        uploadQueue.add(file, path).then(() => { 
            updateProgress(100);
            showLoading("\u2705 上传成功: " + path);
            setTimeout(() => {
                refresh(); 
                hideLoading();
            }, 1500);
        }).catch(err => {
            showLoading("\u274c 上传失败: " + path);
            setTimeout(() => hideLoading(), 2000);
        }).finally(() => {});
    }
    
    function now() { return new Date(new Date().getTime() + 8*3600000).toISOString().replace("T"," ").slice(0,19); }
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
    function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('drop-zone').classList.add('dragover'); }
    function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('drop-zone').classList.remove('dragover'); }
    
    function initApp() {
        if (baseToken && baseRepo) {
            initBtn();
            getDir("", true);
        } else if(baseRepo && !baseToken) {
            document.getElementById("file_list").innerHTML = '<div class="empty-folder-hint">⚙️ 请点击「配置」设置Token</div>';
        }
    }
</script>
</body>
</html>`;
        
        return new Response(html, {
            headers: {
                "Content-Type": "text/html;charset=UTF-8",
            },
        });
}

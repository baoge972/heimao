#!/bin/bash

# ============================================
# 服务器全面检测脚本 v3.6
# 同时支持：宿主机Nginx + Docker Nginx（科技lion）
# 修复：直接从配置文件名提取域名，避免 \r 和 server_name 提取问题
# v3.5：手动服务(Python/Node/Uvicorn)端口改用 ss 按进程树实测（不再猜命令行参数）并统一补 域名/类型/根目录；
#        映射与【7】清单补 Docker-nginx 站点来源（修“nginx 仅在容器时漏列”）；【9】协议前缀按 HTTPS/HTTP 动态显示；生成时间固定为北京时间
# v3.6：【9】Docker-nginx 分支对齐宿主机分支（补 proxy_pass 识别、优先取 server_name、过滤 /var/www/letsencrypt 等 ACME 目录不当站点根误报、去尾空格）；
#        Python/Node/Uvicorn 三段 pgrep 结果加父子去重（sh 外壳与其子进程只列一行）；报告同时存一份到家目录 服务器检测报告.txt（覆盖式仅一份、纯净无色彩）
# 用法: curl -sL https://git.baoge.wang/baoge.sh | bash
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ===== 报告同时存一份到家目录：屏幕带色、文件存纯净文本、每次覆盖只留一份 =====
OUTFILE="$HOME/服务器检测报告.txt"
REPORT_TMP=$(mktemp)
exec 3>&1              # 保存原始 stdout
exec > "$REPORT_TMP" 2>&1   # 报告全程先写入临时文件

echo ""
echo "=========================================="
echo "         服务器全面检测报告"
echo "         生成时间: $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=========================================="
echo ""

# -------------------- 系统信息 --------------------
echo -e "${BLUE}【1】系统信息${NC}"
echo "----------------------------------------"
cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | sed 's/^/  /'
uname -r | sed 's/^/  内核: /'
uptime -p | sed 's/^/  运行时间: /'
echo "  当前用户: $(whoami)"

# -------------------- CPU --------------------
echo -e "\n${BLUE}【2】CPU 信息${NC}"
echo "----------------------------------------"
lscpu | grep "Model name" | sed 's/^/  /'
echo "  核心数: $(nproc)"
echo "  架构: $(uname -m)"

# -------------------- 内存 --------------------
echo -e "\n${BLUE}【3】内存信息${NC}"
echo "----------------------------------------"
free -h | grep -E "Mem|Swap" | sed 's/^/  /'

# -------------------- 硬盘 --------------------
echo -e "\n${BLUE}【4】硬盘信息${NC}"
echo "----------------------------------------"
df -h | grep -E "Filesystem|/dev/sd|/dev/vd" | sed 's/^/  /'

# -------------------- 端口占用 --------------------
echo -e "\n${BLUE}【5】端口占用情况${NC}"
echo "----------------------------------------"
PORT_LIST=$(ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | sed 's/.*://' | sort -n | uniq)
echo "  已占用端口: $(echo "$PORT_LIST" | tr '\n' ' ')"
echo ""
echo "  详细监听:"
ss -tlnp 2>/dev/null | grep LISTEN | awk '{print "    " $4 " -> " $7}' | sed 's/users:(("//' | sed 's/",.*//' | sort -n | uniq

# -------------------- Docker 容器 --------------------
echo -e "\n${BLUE}【6】Docker 容器${NC}"
echo "----------------------------------------"
if command -v docker &> /dev/null; then
    echo "  容器总数: $(docker ps -a -q 2>/dev/null | wc -l)"
    echo "  运行中: $(docker ps -q 2>/dev/null | wc -l)"
    echo ""
    docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | sed 's/^/  /'
else
    echo "  Docker 未安装"
fi

# -------------------- Nginx 有效配置文件清单 --------------------
# 优先用 nginx -T 拿到 nginx 实际加载的全部文件（含被 include 拆分的子文件），
# 拿不到时回退到 conf.d / sites-enabled 通配。
nginx_conf_files() {
    local files=""
    if command -v nginx &> /dev/null; then
        files=$(nginx -T 2>/dev/null | grep -oP '(?<=^# configuration file ).*(?=:$)')
    fi
    if [ -z "$files" ]; then
        files=$(printf '%s\n' /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*)
    fi
    for f in $files; do
        [ -f "$f" ] && echo "$f"
    done | sort -u
}

# 递归收集某 PID 及其所有子孙进程 PID（pm2 守护进程会 fork 子进程，真正监听 socket 的往往是子进程）
pid_tree() {
    local p="$1"
    echo "$p"
    local c
    for c in $(pgrep -P "$p" 2>/dev/null); do
        pid_tree "$c"
    done
}

# 反查某进程(含子孙)在 ss 中真实监听的 TCP 端口（空格分隔；纯 ss 实测，不猜命令行参数）
listen_ports() {
    local top="$1" p ports=""
    for p in $(pid_tree "$top" | sort -u); do
        ports="$ports $(ss -tlnp 2>/dev/null | grep "pid=$p," | awk '{print $4}' | sed 's/.*://' | grep -E '^[0-9]+$')"
    done
    echo "$ports" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -un | paste -sd' '
}

# 读取 Docker-nginx 容器内 conf 全文，交给宿主机 grep 处理（容器多为 busybox，其 grep 不支持 -P）
nginx_dconf() {
    docker exec nginx cat "/etc/nginx/conf.d/$1" 2>/dev/null
}

# 候选 PID 去重：若某 PID 的祖辈也在候选列表里则剔除，同一进程树只保留最上层
# （处理 sh -c "...uvicorn..." 外壳与其子进程都被 pgrep -f 命中、导致同一服务重复列行）
top_pids() {
    local all=" $* " p a up out=""
    for p in $*; do
        up=""
        a="$p"
        while a=$(ps -o ppid= -p "$a" 2>/dev/null | tr -d ' ') && [ -n "$a" ] && [ "$a" != "0" ]; do
            case "$all" in *" $a "*) up="$a"; break;; esac
        done
        [ -z "$up" ] && out="$out $p"
    done
    echo $out
}

# -------------------- 已部署项目清单 --------------------
echo -e "\n${BLUE}【7】已部署项目清单${NC}"
echo "----------------------------------------"

COUNT=0

# ===== 构建 端口/目录 -> 域名 映射（用于把手动服务关联到 Nginx 域名） =====
declare -A PORT_DOMAIN   # key: 端口号, value: 域名列表
declare -A DIR_DOMAIN    # key: 绝对目录, value: 域名列表

# 只在 nginx 实际加载的文件上构建映射（nginx_conf_files）
for conf in $(nginx_conf_files); do
    [ -f "$conf" ] || continue
    SN=$(grep -E "^\s*server_name\s+" "$conf" 2>/dev/null | head -1 | sed 's/.*server_name//; s/;//' | xargs)
    [ -z "$SN" ] && continue
    [ "$SN" = "_" ] && continue

    # 反代 -> 端口映射（仅回环地址，排除容器内网名如 http://kvideo:3000 导致的撞号误关联）
    for p in $(grep -oP 'proxy_pass\s+https?://(127\.0\.0\.1|localhost|0\.0\.0\.0):\K\d+' "$conf" 2>/dev/null | sort -u); do
        PORT_DOMAIN[$p]="${PORT_DOMAIN[$p]:-}${PORT_DOMAIN[$p]:+, }$SN"
    done

    # 静态 root/alias -> 目录映射
    for d in $(grep -oP '^\s*(root|alias)\s+\K[^;]+' "$conf" 2>/dev/null | sort -u); do
        abs=$(readlink -f "$d" 2>/dev/null)
        [ -n "$abs" ] && DIR_DOMAIN[$abs]="${DIR_DOMAIN[$abs]:-}${DIR_DOMAIN[$abs]:+, }$SN"
    done
done

# Docker 容器内 Nginx（科技lion）的反代端口也补进映射（宿主机无 nginx 时靠这里兜住）
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^nginx$'; then
    for dconf in $(docker exec nginx ls /etc/nginx/conf.d/ 2>/dev/null | grep '\.conf$' | grep -v default); do
        dSN=$(nginx_dconf "$dconf" | grep -E "^[[:space:]]*server_name" | head -1 | tr -d '\r' | sed 's/.*server_name//; s/;//' | xargs)
        if [ -z "$dSN" ] || [ "$dSN" = "_" ]; then dSN=$(echo "$dconf" | sed 's/\.conf$//'); fi
        for p in $(nginx_dconf "$dconf" | grep -oP 'proxy_pass\s+https?://(127\.0\.0\.1|localhost|0\.0\.0\.0):\K\d+' | sort -u); do
            PORT_DOMAIN[$p]="${PORT_DOMAIN[$p]:-}${PORT_DOMAIN[$p]:+, }$dSN"
        done
    done
fi

# 1. Docker 项目
if command -v docker &> /dev/null; then
    for name in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do
        COUNT=$((COUNT+1))
        STATUS=$(docker inspect "$name" --format='{{.State.Status}}' 2>/dev/null)
        PORTS=$(docker port "$name" 2>/dev/null | awk '{print $3}' | tr '\n' ' ')
        echo "  $COUNT. $name"
        echo "     部署方式: Docker"
        echo "     状态: $STATUS"
        echo "     端口: $PORTS"
        echo ""
    done
fi

# 2. Python http.server 静态文件服务（可多个实例）
for pid in $(top_pids $(pgrep -f "python3? .*-m http\.server" 2>/dev/null)); do
    # 真实监听端口：ss 按进程树反查（不再从命令行猜，避免多进程声称同一端口）
    PORT=$(listen_ports "$pid")
    # 站点根目录 = 进程工作目录
    SROOT=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)

    # 关联域名：先按真实端口反查，再按目录反查
    DOMAINS=""
    for pr in $PORT; do
        [ -n "${PORT_DOMAIN[$pr]:-}" ] && DOMAINS="${PORT_DOMAIN[$pr]}" && break
    done
    [ -z "$DOMAINS" ] && [ -n "$SROOT" ] && DOMAINS="${DIR_DOMAIN[$SROOT]:-}"
    [ -z "$DOMAINS" ] && DOMAINS="未关联（Nginx 未反代该端口/目录）"

    COUNT=$((COUNT+1))
    echo "  $COUNT. Python 静态文件服务 (http.server)"
    echo "     域名: $DOMAINS"
    echo "     部署方式: 手动 (Python http.server)"
    echo "     类型: 静态文件"
    echo "     端口: ${PORT:-无 TCP 监听}"
    echo "     站点根目录: ${SROOT:-未知}"
    echo "     PID: $pid"
    echo "     状态: 运行中"
    echo ""
done

# 3. Node.js 服务（可多个实例）
for pid in $(top_pids $(pgrep -f "node.*server\.js" 2>/dev/null)); do
    # 真实监听端口：ss 按进程树反查（pm2 子进程才是监听者）
    PORT=$(listen_ports "$pid")
    SROOT=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
    # 关联域名：按反查到的端口逐个查映射表
    DOMAINS=""
    for pr in $PORT; do
        [ -n "${PORT_DOMAIN[$pr]:-}" ] && DOMAINS="${PORT_DOMAIN[$pr]}" && break
    done
    [ -z "$DOMAINS" ] && DOMAINS="未关联（Nginx 未反代该端口，常见于前端直连后端）"

    COUNT=$((COUNT+1))
    echo "  $COUNT. Node.js 后端服务"
    echo "     域名: $DOMAINS"
    echo "     部署方式: 手动 (Node.js)"
    echo "     类型: 动态服务"
    echo "     端口: ${PORT:-无 TCP 监听}"
    echo "     工作目录: ${SROOT:-未知}"
    echo "     PID: $pid"
    echo "     状态: 运行中"
    echo ""
done

# 4. Uvicorn 服务（可多个实例）
for pid in $(top_pids $(pgrep -f "uvicorn" 2>/dev/null)); do
    PORT=$(listen_ports "$pid")
    SROOT=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
    DOMAINS=""
    for pr in $PORT; do
        [ -n "${PORT_DOMAIN[$pr]:-}" ] && DOMAINS="${PORT_DOMAIN[$pr]}" && break
    done
    [ -z "$DOMAINS" ] && [ -n "$SROOT" ] && DOMAINS="${DIR_DOMAIN[$SROOT]:-}"
    [ -z "$DOMAINS" ] && DOMAINS="未关联（Nginx 未反代该端口/目录）"
    COUNT=$((COUNT+1))
    echo "  $COUNT. Uvicorn API 服务"
    echo "     域名: $DOMAINS"
    echo "     部署方式: 手动 (Python/Uvicorn)"
    echo "     类型: 动态服务 (API)"
    echo "     端口: ${PORT:-无 TCP 监听}"
    echo "     工作目录: ${SROOT:-未知}"
    echo "     PID: $pid"
    echo "     状态: 运行中"
    echo ""
done

# 5. 宿主机 Nginx 配置的站点
if command -v nginx &> /dev/null; then
    for conf in $(nginx_conf_files); do
        if [ -f "$conf" ]; then
            DOMAINS=$(grep -E "^\s*server_name\s+" "$conf" 2>/dev/null | head -1 | sed 's/.*server_name//' | sed 's/;//' | xargs)
            if [ -n "$DOMAINS" ] && [ "$DOMAINS" != "_" ]; then
                COUNT=$((COUNT+1))
                if grep -q "listen 443" "$conf" 2>/dev/null; then
                    SSL="HTTPS (有证书)"
                else
                    SSL="HTTP (无证书)"
                fi
                STATIC_ROOTS=$(grep -oP '^\s*(root|alias)\s+\K[^;]+' "$conf" 2>/dev/null | sort -u | tr '\n' ' ')
                if grep -q "proxy_pass" "$conf" 2>/dev/null; then
                    TYPE="反向代理"
                    [ -n "$STATIC_ROOTS" ] && TYPE="反向代理 + 静态目录"
                else
                    TYPE="静态文件"
                fi
                echo "  $COUNT. $DOMAINS"
                echo "     部署方式: 手动 (Nginx)"
                echo "     类型: $TYPE"
                echo "     协议: $SSL"
                [ -n "$STATIC_ROOTS" ] && echo "     站点根目录: $STATIC_ROOTS"
                echo "     配置文件: $conf"
                echo ""
            fi
        fi
    done
fi

# 6. Docker 容器内 Nginx 的站点（科技lion 部署；宿主机无 nginx 时【7】易漏，这里补上）
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^nginx$'; then
    for dconf in $(docker exec nginx ls /etc/nginx/conf.d/ 2>/dev/null | grep '\.conf$' | grep -v default); do
        dSN=$(nginx_dconf "$dconf" | grep -E "^[[:space:]]*server_name" | head -1 | tr -d '\r' | sed 's/.*server_name//; s/;//' | xargs)
        if [ -z "$dSN" ] || [ "$dSN" = "_" ]; then dSN=$(echo "$dconf" | sed 's/\.conf$//'); fi
        COUNT=$((COUNT+1))
        if nginx_dconf "$dconf" | grep -q "proxy_pass"; then TYPE="反向代理"; else TYPE="静态文件"; fi
        if nginx_dconf "$dconf" | grep -q "listen 443"; then SSL="HTTPS (有证书)"; else SSL="HTTP (无证书)"; fi
        echo "  $COUNT. $dSN"
        echo "     部署方式: Docker Nginx"
        echo "     类型: $TYPE"
        echo "     协议: $SSL"
        echo "     配置文件: /etc/nginx/conf.d/$dconf"
        echo ""
    done
fi

if [ $COUNT -eq 0 ]; then
    echo "  未检测到已部署的项目"
else
    echo "  ✅ 项目总数: $COUNT"
fi
echo ""

# -------------------- 运行中的系统服务 --------------------
echo -e "${BLUE}【8】运行中的系统服务${NC}"
echo "----------------------------------------"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -20 | sed 's/^/  /'
echo "  ..."
echo ""

# -------------------- Nginx 站点配置详情（宿主机 + Docker） --------------------
echo -e "${BLUE}【9】Nginx 站点配置详情${NC}"
echo "----------------------------------------"

NGINX_FOUND=0

# 检测宿主机 Nginx
if command -v nginx &> /dev/null && systemctl is-active --quiet nginx 2>/dev/null; then
    NGINX_FOUND=1
    echo "  [宿主机] Nginx 状态: 运行中"
    echo "  配置文件:"
    for conf in $(nginx_conf_files); do
        if [ -f "$conf" ]; then
            DOMAIN=$(grep -E "^\s*server_name\s+" "$conf" 2>/dev/null | head -1 | sed 's/.*server_name//' | sed 's/;//' | xargs)
            if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
                if grep -q "listen 443" "$conf" 2>/dev/null; then
                    SSL_STATUS="✅ HTTPS"; SCHEME="https"; ICON="✅"
                else
                    SSL_STATUS="❌ HTTP"; SCHEME="http"; ICON="⚠️"
                fi
                if grep -q "proxy_pass" "$conf" 2>/dev/null; then
                    PROXY_STATUS="反向代理"
                else
                    PROXY_STATUS="静态文件"
                fi
                # 过滤 ACME/证书校验目录，避免把 /var/www/letsencrypt 当站点根误报；去尾空格
                DNS_ROOTS=$(grep -oP '^\s*(root|alias)\s+\K[^;]+' "$conf" 2>/dev/null | sort -u | grep -Ev '/var/www/(letsencrypt|certbot)|\.well-known' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
                echo "    $ICON ${SCHEME}://$DOMAIN ($PROXY_STATUS, $SSL_STATUS)"
                [ -n "$DNS_ROOTS" ] && echo "      静态根目录: $DNS_ROOTS"
                echo "      配置文件: $conf"
            fi
        fi
    done
fi

# 检测 Docker 容器内的 Nginx（科技lion部署）
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^nginx$'; then
    NGINX_FOUND=1
    echo "  [Docker容器] Nginx 状态: 运行中"
    echo "  配置文件:"
    for conf in $(docker exec nginx ls /etc/nginx/conf.d/ 2>/dev/null | grep '\.conf$' | grep -v default); do
        # 优先取真实 server_name，取不到再回退文件名（修 map 这类 文件名≠域名）
        DOMAIN=$(nginx_dconf "$conf" | grep -E "^[[:space:]]*server_name" | head -1 | tr -d '\r' | sed 's/.*server_name//; s/;//' | xargs)
        if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "_" ]; then DOMAIN=$(echo "$conf" | sed 's/\.conf$//'); fi
        if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
            if nginx_dconf "$conf" | grep -q "listen 443"; then
                SSL_STATUS="✅ HTTPS"; SCHEME="https"; ICON="✅"
            else
                SSL_STATUS="❌ HTTP"; SCHEME="http"; ICON="⚠️"
            fi
            if nginx_dconf "$conf" | grep -q "proxy_pass"; then
                PROXY_STATUS="反向代理"
            else
                PROXY_STATUS="静态文件"
            fi
            # 过滤 ACME/证书校验目录，避免把 /var/www/letsencrypt 当站点根误报；去尾空格
            DY_ROOTS=$(nginx_dconf "$conf" | grep -oP '^\s*(root|alias)\s+\K[^;]+' | sort -u | grep -Ev '/var/www/(letsencrypt|certbot)|\.well-known' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
            echo "    $ICON ${SCHEME}://$DOMAIN ($PROXY_STATUS, $SSL_STATUS)"
            [ -n "$DY_ROOTS" ] && echo "      静态根目录: $DY_ROOTS"
            echo "      配置文件: /etc/nginx/conf.d/$conf"
        fi
    done
fi

if [ $NGINX_FOUND -eq 0 ]; then
    echo "  Nginx 未运行或未安装"
fi
echo ""

# -------------------- 防火墙状态 --------------------
echo -e "${BLUE}【10】防火墙状态${NC}"
echo "----------------------------------------"
if command -v ufw &> /dev/null; then
    echo "  UFW: $(ufw status 2>/dev/null | head -1)"
fi
if command -v iptables &> /dev/null; then
    echo "  iptables 规则数: $(iptables -L -n 2>/dev/null | wc -l)"
fi
echo ""

# -------------------- 公网 IP --------------------
echo -e "${BLUE}【11】公网 IP${NC}"
echo "----------------------------------------"
PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null)
if [ -n "$PUBLIC_IP" ]; then
    echo "  公网 IP: $PUBLIC_IP"
else
    echo "  公网 IP: 获取失败"
fi
echo ""

# -------------------- 资源占用 TOP --------------------
echo -e "${BLUE}【12】资源占用 TOP 10${NC}"
echo "----------------------------------------"
echo "  CPU 占用 Top 5:"
ps aux --sort=-%cpu | head -6 | sed 's/^/    /'
echo ""
echo "  内存占用 Top 5:"
ps aux --sort=-%mem | head -6 | sed 's/^/    /'
echo ""

# -------------------- 快速总结 --------------------
echo -e "${BLUE}【13】快速总结${NC}"
echo "----------------------------------------"
MEM_TOTAL=$(free -m | grep Mem | awk '{print $2}')
MEM_USED=$(free -m | grep Mem | awk '{print $3}')
MEM_FREE=$(free -m | grep Mem | awk '{print $7}')
DISK_USED=$(df -h / | tail -1 | awk '{print $5}')
CPU_CORES=$(nproc)

echo "  CPU 核心: $CPU_CORES"
echo "  内存总量: ${MEM_TOTAL}MiB"
echo "  内存已用: ${MEM_USED}MiB"
echo "  内存可用: ${MEM_FREE}MiB"
echo "  硬盘使用: $DISK_USED"
echo "  容器总数: $(docker ps -a -q 2>/dev/null | wc -l)"
echo "  运行中容器: $(docker ps -q 2>/dev/null | wc -l)"

if [ $MEM_TOTAL -lt 1024 ]; then
    echo -e "  ${YELLOW}⚠️ 警告: 内存偏小 (${MEM_TOTAL}MiB)，部署新服务请选择轻量级方案${NC}"
else
    echo -e "  ${GREEN}✅ 内存充足${NC}"
fi

if [ "${DISK_USED%\%}" -gt 85 ]; then
    echo -e "  ${YELLOW}⚠️ 警告: 磁盘使用率 $DISK_USED，建议清理空间${NC}"
else
    echo -e "  ${GREEN}✅ 磁盘空间正常${NC}"
fi

echo ""
echo "=========================================="
echo "         检测完成！"
echo "=========================================="

# ===== 还原输出：屏幕带色显示 + 写出纯净汇总文件（覆盖旧文件） =====
exec 1>&3 2>&1
cat "$REPORT_TMP"
sed -r 's/\x1b\[[0-9;]*m//g' "$REPORT_TMP" > "$OUTFILE"
rm -f "$REPORT_TMP"
echo "  📄 汇总已保存: $OUTFILE"
#!/bin/bash

# ============================================
# 服务器全面检测脚本 v3.2
# 同时支持：宿主机Nginx + Docker Nginx（科技lion）
# 修复：完整显示所有 server_name，修复 SSL 检测错误
# 用法: ./baoge.sh
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "=========================================="
echo "         服务器全面检测报告"
echo "         生成时间: $(date)"
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

# -------------------- 已部署项目清单 --------------------
echo -e "\n${BLUE}【7】已部署项目清单${NC}"
echo "----------------------------------------"

COUNT=0

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

# 2. Python HTTP 服务
if ps aux | grep -v grep | grep -q "python3 -m http.server"; then
    COUNT=$((COUNT+1))
    PORT=$(ps aux | grep -v grep | grep "python3 -m http.server" | head -1 | grep -oP '(?<=http.server )\d+' || echo "8080")
    echo "  $COUNT. Python HTTP Server"
    echo "     部署方式: 手动 (Python)"
    echo "     端口: $PORT"
    echo "     状态: 运行中"
    echo ""
fi

# 3. Node.js 服务
if ps aux | grep -v grep | grep -q "node.*server.js"; then
    COUNT=$((COUNT+1))
    echo "  $COUNT. Node.js 后端服务"
    echo "     部署方式: 手动 (Node.js)"
    echo "     状态: 运行中"
    echo "     提示: 端口未在进程参数中明确，请检查代码"
    echo ""
fi

# 4. Uvicorn 服务
if ps aux | grep -v grep | grep -q "uvicorn"; then
    COUNT=$((COUNT+1))
    PORT=$(ps aux | grep -v grep | grep "uvicorn" | head -1 | grep -oP '(?<=--port )\d+' || echo "8080")
    echo "  $COUNT. Uvicorn API 服务"
    echo "     部署方式: 手动 (Python/Uvicorn)"
    echo "     端口: $PORT"
    echo "     状态: 运行中"
    echo ""
fi

# 5. 宿主机 Nginx 配置的站点
if command -v nginx &> /dev/null; then
    for conf in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do
        if [ -f "$conf" ]; then
            DOMAINS=$(grep -E "^\s*server_name\s+" "$conf" 2>/dev/null | head -1 | sed 's/.*server_name//' | sed 's/;//' | xargs)
            if [ -n "$DOMAINS" ] && [ "$DOMAINS" != "_" ]; then
                COUNT=$((COUNT+1))
                if grep -q "listen 443" "$conf" 2>/dev/null; then
                    SSL="HTTPS (有证书)"
                else
                    SSL="HTTP (无证书)"
                fi
                if grep -q "proxy_pass" "$conf" 2>/dev/null; then
                    TYPE="反向代理"
                else
                    TYPE="静态文件"
                fi
                echo "  $COUNT. $DOMAINS"
                echo "     部署方式: 手动 (Nginx)"
                echo "     类型: $TYPE"
                echo "     协议: $SSL"
                echo "     配置文件: $conf"
                echo ""
            fi
        fi
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
    for conf in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do
        if [ -f "$conf" ]; then
            DOMAIN=$(grep -E "^\s*server_name\s+" "$conf" 2>/dev/null | head -1 | sed 's/.*server_name//' | sed 's/;//' | xargs)
            if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
                # 判断 SSL
                if grep -q "listen 443" "$conf" 2>/dev/null; then
                    SSL_STATUS="✅ HTTPS"
                else
                    SSL_STATUS="❌ HTTP"
                fi
                # 判断类型
                if grep -q "proxy_pass" "$conf" 2>/dev/null; then
                    PROXY_STATUS="反向代理"
                else
                    PROXY_STATUS="静态文件"
                fi
                echo "    - $DOMAIN ($PROXY_STATUS, $SSL_STATUS)"
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
        # 修复：提取所有 server_name（使用 sed 替代 awk）
        DOMAIN=$(docker exec nginx cat "/etc/nginx/conf.d/$conf" 2>/dev/null | grep -E "^\s*server_name\s+" | head -1 | sed 's/.*server_name//' | sed 's/;//' | xargs)
        if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
            # 修复：使用 grep -q 判断 SSL，避免 [: too many arguments 错误
            if docker exec nginx grep -q "listen 443" "/etc/nginx/conf.d/$conf" 2>/dev/null; then
                SSL_STATUS="✅ HTTPS"
            else
                SSL_STATUS="❌ HTTP"
            fi
            echo "    - $DOMAIN ($SSL_STATUS)"
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
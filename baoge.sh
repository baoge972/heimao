#!/bin/bash
# ============================================
# 服务器全面检测脚本 v3.0
# 专为科技lion Docker环境优化
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
echo -e "${BLUE}【1】系统信息${NC}"
echo "----------------------------------------"
cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | sed 's/^/  /'
uname -r | sed 's/^/  内核: /'
uptime -p | sed 's/^/  运行时间: /'
echo "  当前用户: $(whoami)"
echo -e "\n${BLUE}【2】CPU 信息${NC}"
echo "----------------------------------------"
lscpu | grep "Model name" | sed 's/^/  /'
echo "  核心数: $(nproc)"
echo "  架构: $(uname -m)"
echo -e "\n${BLUE}【3】内存信息${NC}"
echo "----------------------------------------"
free -h | grep -E "Mem|Swap" | sed 's/^/  /'
echo -e "\n${BLUE}【4】硬盘信息${NC}"
echo "----------------------------------------"
df -h | grep -E "Filesystem|/dev/sd|/dev/vd" | sed 's/^/  /'
echo -e "\n${BLUE}【5】端口占用情况${NC}"
echo "----------------------------------------"
PORT_LIST=$(ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | sed 's/.*://' | sort -n | uniq)
echo "  已占用端口: $(echo "$PORT_LIST" | tr '\n' ' ')"
echo ""
echo "  详细监听:"
ss -tlnp 2>/dev/null | grep LISTEN | awk '{print "    " $4 " -> " $7}' | sed 's/users:(("//' | sed 's/",.*//' | sort -n | uniq
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
echo -e "\n${BLUE}【7】已部署项目清单${NC}"
echo "----------------------------------------"
COUNT=0
if command -v docker &> /dev/null; then
    for name in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do
        COUNT=$((COUNT+1))
        STATUS=$(docker inspect "$name" --format='{{.State.Status}}' 2>/dev/null)
        PORTS=$(docker port "$name" 2>/dev/null | awk '{print $3}' | tr '\n' ' ')
        echo "  $COUNT. $name"
        echo "     状态: $STATUS"
        echo "     端口: $PORTS"
        echo ""
    done
fi
if [ $COUNT -eq 0 ]; then
    echo "  未检测到任何容器"
else
    echo "  ✅ 项目总数: $COUNT"
fi
echo -e "\n${BLUE}【8】Nginx 配置详情${NC}"
echo "----------------------------------------"
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^nginx$'; then
    echo "  Nginx (Docker容器) 状态: 运行中"
    echo "  已配置的站点:"
    for conf in $(docker exec nginx ls /etc/nginx/conf.d/ 2>/dev/null | grep '\.conf$' | grep -v default); do
        DOMAIN=$(docker exec nginx cat "/etc/nginx/conf.d/$conf" 2>/dev/null | grep -E "^\s*server_name\s+" | head -1 | awk '{print $2}' | sed 's/;//')
        if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
            HAS_SSL=$(docker exec nginx grep -c "listen 443" "/etc/nginx/conf.d/$conf" 2>/dev/null || echo 0)
            SSL_STATUS=$([ "$HAS_SSL" -gt 0 ] && echo "✅ HTTPS" || echo "❌ HTTP")
            echo "    - $DOMAIN ($SSL_STATUS)"
        fi
    done
else
    echo "  Nginx 容器未运行"
fi
echo -e "\n${BLUE}【9】防火墙状态${NC}"
echo "----------------------------------------"
if command -v ufw &> /dev/null; then
    echo "  UFW: $(ufw status 2>/dev/null | head -1)"
fi
if command -v iptables &> /dev/null; then
    echo "  iptables 规则数: $(iptables -L -n 2>/dev/null | wc -l)"
fi
echo -e "\n${BLUE}【10】公网 IP${NC}"
echo "----------------------------------------"
PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null)
if [ -n "$PUBLIC_IP" ]; then
    echo "  公网 IP: $PUBLIC_IP"
else
    echo "  公网 IP: 获取失败"
fi
echo -e "\n${BLUE}【11】资源占用 TOP 5${NC}"
echo "----------------------------------------"
echo "  CPU 占用 Top 5:"
ps aux --sort=-%cpu | head -6 | sed 's/^/    /'
echo ""
echo "  内存占用 Top 5:"
ps aux --sort=-%mem | head -6 | sed 's/^/    /'
echo -e "\n${BLUE}【12】快速总结${NC}"
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
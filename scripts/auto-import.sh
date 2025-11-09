#!/bin/bash

# 自动化导入脚本 - 分批导入PDF到向量数据库
# 每次处理5个chunks，避免超过Cloudflare Workers免费套餐的10ms CPU限制

set -e  # 遇到错误立即退出

# ============ 配置 ============
API_URL="https://arg.mikasa-ackerman.vip/api/reindex"
MAX_CHUNKS_PER_BATCH=5
DELAY_BETWEEN_BATCHES=3  # 每批之间延迟3秒

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ============ 函数 ============

# 打印彩色消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示进度条
show_progress() {
    local current=$1
    local total=$2
    local width=50
    local percentage=$((current * 100 / total))
    local completed=$((width * current / total))
    local remaining=$((width - completed))

    printf "\r${BLUE}[Progress]${NC} ["
    printf "%${completed}s" | tr ' ' '='
    printf "%${remaining}s" | tr ' ' '-'
    printf "] %d%% (%d/%d chunks)" "$percentage" "$current" "$total"
}

# ============ 主程序 ============

print_info "=========================================="
print_info "  自动化导入向量数据库"
print_info "=========================================="
print_info "API地址: $API_URL"
print_info "每批处理: $MAX_CHUNKS_PER_BATCH 个chunks"
print_info "批次延迟: ${DELAY_BETWEEN_BATCHES}秒"
echo ""

START_CHUNK=0
BATCH_COUNT=0
TOTAL_PROCESSED=0
TOTAL_CHUNKS=0
HAS_MORE=true

print_info "开始导入..."
echo ""

while [ "$HAS_MORE" = "true" ]; do
    BATCH_COUNT=$((BATCH_COUNT + 1))

    print_info "正在处理第 $BATCH_COUNT 批 (startChunk: $START_CHUNK)..."

    # 调用API
    RESPONSE=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"startChunk\": $START_CHUNK, \"maxChunks\": $MAX_CHUNKS_PER_BATCH}")

    # 检查响应是否为空
    if [ -z "$RESPONSE" ]; then
        print_error "API返回空响应！"
        exit 1
    fi

    # 解析JSON响应（使用grep和sed，兼容性好）
    SUCCESS=$(echo "$RESPONSE" | grep -o '"success":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    CHUNKS=$(echo "$RESPONSE" | grep -o '"chunks":[0-9]*' | cut -d':' -f2)
    TOTAL_CHUNKS=$(echo "$RESPONSE" | grep -o '"totalChunks":[0-9]*' | cut -d':' -f2)
    HAS_MORE=$(echo "$RESPONSE" | grep -o '"hasMore":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    NEXT_START=$(echo "$RESPONSE" | grep -o '"nextStartChunk":[0-9]*' | cut -d':' -f2)
    ERRORS=$(echo "$RESPONSE" | grep -o '"errors":\[[^]]*\]')

    # 检查是否成功
    if [ "$SUCCESS" != "true" ]; then
        print_error "批次 $BATCH_COUNT 失败！"
        echo "响应: $RESPONSE"
        exit 1
    fi

    # 更新进度
    TOTAL_PROCESSED=$((TOTAL_PROCESSED + CHUNKS))

    # 显示进度
    if [ ! -z "$TOTAL_CHUNKS" ] && [ "$TOTAL_CHUNKS" -gt 0 ]; then
        show_progress "$TOTAL_PROCESSED" "$TOTAL_CHUNKS"
        echo ""  # 换行
    fi

    print_success "批次 $BATCH_COUNT 完成: 处理了 $CHUNKS 个chunks"

    # 检查是否有错误
    if [ ! -z "$ERRORS" ] && [ "$ERRORS" != '"errors":[]' ]; then
        print_warning "发现错误: $ERRORS"
    fi

    # 检查是否还有更多数据
    if [ "$HAS_MORE" = "true" ]; then
        if [ ! -z "$NEXT_START" ]; then
            START_CHUNK=$NEXT_START
            print_info "等待 ${DELAY_BETWEEN_BATCHES} 秒后继续..."
            sleep $DELAY_BETWEEN_BATCHES
            echo ""
        else
            print_warning "hasMore=true 但没有 nextStartChunk，停止处理"
            break
        fi
    else
        print_success "所有数据导入完成！"
        break
    fi

    # 安全检查：防止无限循环
    if [ $BATCH_COUNT -gt 100 ]; then
        print_error "已处理100批次，超过预期，停止处理"
        exit 1
    fi
done

echo ""
print_info "=========================================="
print_success "导入完成！"
print_info "=========================================="
print_info "总批次数: $BATCH_COUNT"
print_info "总chunks: $TOTAL_PROCESSED / $TOTAL_CHUNKS"
echo ""

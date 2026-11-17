export const mcpScopes = ['ledger:accounts:read', 'ledger:entries:read', 'ledger:entries:create', 'ledger:refunds:create'] as const
export const mcpScopeLabels: Record<typeof mcpScopes[number], { name: string; description: string }> = {
  'ledger:accounts:read': { name: '读取交易账户', description: '查看你的全部交易账户及余额。' },
  'ledger:entries:read': { name: '读取账单流水', description: '查看你的账单流水列表、单笔详情、退款关联和转账对侧。' },
  'ledger:entries:create': { name: '新建收支流水', description: '为你登记收入或支出。' },
  'ledger:refunds:create': { name: '登记退款', description: '为已有支出追加退款收入。' },
}

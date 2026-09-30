/**
 * Widget copy. The active language always comes from DSH's locale service, and
 * the bundle carries both dictionaries so the widget never fetches anything.
 */

export const MESSAGES = Object.freeze({
  en: Object.freeze({
    'hud.title': 'Activity Status',
    'hud.link': 'External Link',
    'hud.online': 'ONLINE',
    'hud.offline': 'OFFLINE',
    'hud.sync': 'Synchro',
    'hud.active': 'Active Time',
    'hud.balance': 'Balance',
    'hud.status': 'System Status',
    'hud.state.normal': 'Normal',
    'hud.state.caution': 'Caution',
    'hud.state.standby': 'Standby',
    'hud.state.offline': 'Disconnected',
    'hud.legend.normal': 'Nominal',
    'hud.legend.caution': 'Caution',
    'hud.legend.standby': 'Standby',
    'hud.info': 'Activity Information',
    'hud.info.updated': 'Last update',
    'hud.info.tokens': 'Billed tokens',
    'hud.power': 'Auxiliary Power',
    'hud.load': 'Context Load',
    'hud.resize': 'Resize the monitor',
    'hud.aria': '{state}. Sync ratio {sync}. Active time {active}. Link {link}. Click for a line; right-click for settings; arrow keys move.',
    'hud.state.linked': 'Unit linked',
    'unit.name': 'EVA companion',
    'unit.aria': '{state}. Sync ratio {sync}. Active time {active}. Click for a line; right-click or press Enter for settings; arrow keys move.',
    'state.linked': 'Unit linked, all readouts nominal',
    'state.standby': 'Unit standing by, waiting for session data',
    'state.alert': 'Unit reports a low reading',
    'state.offline': 'Unit offline, host connection lost',

    'label.sync': 'Synchro',
    'label.active': 'Active time',

    'panel.title': 'EVA companion',
    'panel.subtitle': 'Sync ratio follows this session’s cache-hit share; active time follows the remaining account balance.',
    'panel.close': 'Close settings',
    'panel.accounts': 'Remaining balance',
    'setting.scale': 'Size',
    'setting.scaleHint': 'Range {min}–{max}%',
    'setting.motion': 'Animations',
    'action.refresh': 'Refresh balance',
    'action.hide': 'Collapse EVA',
    'action.restore': 'Bring the unit back',
    'action.restoreAria': 'Bring the EVA companion back',

    'detail.totalTokens': 'Billed tokens',
    'detail.balance': 'Total remaining',
    'detail.recharge': 'Topped-up balance',
    'detail.bonus': 'Granted balance',
    'detail.none': 'No session data yet',
    'detail.balancePending': 'Reading the remaining balance…',
    'detail.signedOut': 'Sign in to the account to read the balance',
    'detail.failed': 'Balance query failed',
    'detail.failedDetail': 'Balance query failed ({detail})',
    'detail.unrecognized': 'Unrecognized balance answer ({detail})',
    'detail.empty': 'This account holds no wallet',
    'detail.unsupported': 'The account service is not composed in this profile',
    'detail.refreshing': 'Refreshing…',

    // Short quotation shown on hover; the same line in either UI language.
    'bubble.quote': '逃げちゃダメだ',
    'bubble.linked.0': 'All systems nominal.',
    'bubble.linked.1': 'Sync ratio holding. Keep going.',
    'bubble.linked.2': 'Entry plug pressurized.',
    'bubble.linked.3': 'Umbilical connected. Reserves fine.',
    'bubble.standby.0': 'Standing by. Start a session when ready.',
    'bubble.standby.1': 'No signal from a session yet.',
    'bubble.standby.2': 'Power on. Awaiting a task.',
    'bubble.alert.0': 'Sync ratio is dropping. Focus.',
    'bubble.alert.1': 'Reserves are running low.',
    'bubble.alert.2': 'Caution: readouts below threshold.',
    'bubble.offline.0': 'Signal interference. Reconnecting…',
    'bubble.offline.1': 'Umbilical cable detached.',
    'bubble.offline.2': 'Umbilical severed. Running on internal power.',
  }),
  zh: Object.freeze({
    'hud.title': '活動状況',
    'hud.link': '外部接续',
    'hud.online': 'ONLINE',
    'hud.offline': 'OFFLINE',
    'hud.sync': '同期率',
    'hud.active': '活動時間',
    'hud.balance': '残高',
    'hud.status': '系统状态',
    'hud.state.normal': '通常',
    'hud.state.caution': '警戒',
    'hud.state.standby': '待机',
    'hud.state.offline': '断线',
    'hud.legend.normal': '正常',
    'hud.legend.caution': '警戒',
    'hud.legend.standby': '待机',
    'hud.info': '活动情报',
    'hud.info.updated': '最终更新',
    'hud.info.tokens': '累计 token',
    'hud.power': '活动电力残量',
    'hud.load': '上下文负荷',
    'hud.resize': '调整监视器大小',
    'hud.aria': '{state}。同步率 {sync}。活动时间 {active}。外部接续 {link}。点击互动；右键打开设置；方向键移动。',
    'hud.state.linked': '机体已连接',
    'unit.name': 'EVA 同步终端',
    'unit.aria': '{state}。同步率 {sync}。活动时间 {active}。点击互动；右键或 Enter 打开设置；方向键移动。',
    'state.linked': '机体已连接，各项读数正常',
    'state.standby': '机体待机，等待会话数据',
    'state.alert': '机体读数低于阈值',
    'state.offline': '机体离线，与主机失去连接',

    'label.sync': '同步率',
    'label.active': '活动时间',

    'panel.title': 'EVA 同步终端',
    'panel.subtitle': '同步率取当前会话的缓存命中率；活动时间取账户剩余金额。',
    'panel.close': '关闭设置',
    'panel.accounts': '剩余金额',
    'setting.scale': '显示大小',
    'setting.scaleHint': '范围 {min}–{max}%',
    'setting.motion': '动态效果',
    'action.refresh': '刷新余额',
    'action.hide': '收起 EVA',
    'action.restore': '唤回机体',
    'action.restoreAria': '唤回 EVA 同步终端',

    'detail.totalTokens': '计费 token 合计',
    'detail.balance': '剩余合计',
    'detail.recharge': '充值余额',
    'detail.bonus': '赠送余额',
    'detail.none': '暂无会话数据',
    'detail.balancePending': '正在读取余额…',
    'detail.signedOut': '登录账户后可读取余额',
    'detail.failed': '余额查询失败',
    'detail.failedDetail': '余额查询失败（{detail}）',
    'detail.unrecognized': '无法识别的余额返回（{detail}）',
    'detail.empty': '该账户没有钱包',
    'detail.unsupported': '当前 profile 未组装账户服务',
    'detail.refreshing': '刷新中…',

    // Short quotation shown on hover; the same line in either UI language.
    'bubble.quote': '逃げちゃダメだ',
    'bubble.linked.0': '全系统正常。',
    'bubble.linked.1': '同步率稳定，继续。',
    'bubble.linked.2': '插入栓加压完成。',
    'bubble.linked.3': '外部电源已连接，残量充足。',
    'bubble.standby.0': '待机中，随时可以开始。',
    'bubble.standby.1': '尚未接收到会话信号。',
    'bubble.standby.2': '电源接通，等待任务。',
    'bubble.alert.0': '同步率偏低，请集中精神。',
    'bubble.alert.1': '残量不足，注意补给。',
    'bubble.alert.2': '警告：读数低于阈值。',
    'bubble.offline.0': '信号受到干扰，正在重连…',
    'bubble.offline.1': '脐带电缆已断开。',
    'bubble.offline.2': '外部电源切断，切换至内部电源。',
  }),
});

export function normalizeLanguage(language) {
  return typeof language === 'string' && /^zh(?:$|[-_])/i.test(language.trim()) ? 'zh' : 'en';
}

export function translate(language, key, values = {}) {
  const table = MESSAGES[normalizeLanguage(language)];
  const message = table[key] ?? MESSAGES.en[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(values, name) ? String(values[name]) : match));
}

/** Stable bubble line for a state, rotated by an explicit step so it is testable. */
export function bubbleLine(language, state, step) {
  const index = ((step % 3) + 3) % 3;
  const key = `bubble.${state}.${index}`;
  const table = MESSAGES[normalizeLanguage(language)];
  if (table[key] !== undefined || MESSAGES.en[key] !== undefined) return translate(language, key);
  return translate(language, `bubble.standby.${index}`);
}

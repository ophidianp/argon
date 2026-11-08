// What travels along a wire between two agents, by kind of wire. Pure: the server sends what this builds.
//   brief    hand the work on: summary of what A did + A's last reply (the classic hand-off)
//   reply    forward A's last reply word for word
//   review   ask B to review A's work, answering APPROVED or listing fixes
//   feedback B's review goes back to A (only when B did not approve)
//   context  share A's summary with B, for context only

export const LINK_KINDS = ['handoff', 'review', 'forward', 'condition', 'context']

/** A reviewer approves by putting APPROVED at the start of a line. @param {string} text */
export const approved = (text) => /^\W*approved\b/im.test(text)

/** Case-insensitive "contains"; an empty pattern never matches. @param {string} text @param {string} pattern */
export const matches = (text, pattern) => !!pattern?.trim() && text.toLowerCase().includes(pattern.trim().toLowerCase())

/**
 * @param {'brief'|'reply'|'review'|'feedback'|'context'} mode
 * @param {{ fromName: string, brief?: string, reply?: string, role?: string }} p
 */
export function linkMessage(mode, { fromName, brief = '', reply = '', role = '' }) {
  const yourRole = role.trim() ? `\n\nYour role: ${role.trim().slice(0, 500)}` : ''
  if (mode === 'reply') return `${fromName} just replied:\n\n${reply || brief}`
  if (mode === 'context') return `For context only, no action needed: here is where ${fromName} is.\n\n${brief}`
  if (mode === 'review')
    return `Review ${fromName}'s work below. If it is right, reply with APPROVED on its own line. Otherwise list exactly what they must fix.\n\n${brief}${yourRole}`
  if (mode === 'feedback') return `Review from ${fromName}:\n\n${reply}\n\nApply these fixes, then finish.`
  return `Hand-off from ${fromName}. Here is where they left off:\n\n${brief}${yourRole}\n\nPick up from here.`
}

/**
 * Host half of the EVA companion bundle.
 *
 * This plugin contributes no Host service on purpose: both readouts come from
 * Host features the profile already composes.
 *   - Remaining balance: `ctx.remote.account.getBalance()` from
 *     `@deepseek-ai/dsh-api-account-controller`.
 *   - Cache-hit share: the `tokenUsage` session projection from
 *     `@deepseek-ai/dsh-token-meter`.
 * The row therefore exists only to load the browser bundle declared under
 * `dsh.client` in package.json.
 */
export function apply() {}

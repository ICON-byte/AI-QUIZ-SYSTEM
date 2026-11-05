// Only the invitation landing page is an authorized post-authentication return.
export function invitationReturn(value: unknown) {
  return typeof value === 'string' &&
    /^\/challenges\/join(?:#code=[A-Fa-f0-9]{24})?$/.test(value)
    ? value
    : '/dashboard';
}

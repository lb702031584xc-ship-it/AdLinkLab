/**
 * P2-5 — RBAC 角色工具（唯一来源）。
 *
 * 角色（User.role 是 String；既有值 admin/member/researcher 保持有效）：
 * - owner：最高权限；admin 等价 + 唯一可分配 owner 角色。
 * - admin：管理权限；可分配 admin/member/researcher/viewer，不可分配 owner。
 * - member：可写（业务操作）。
 * - researcher / viewer：只读（researcher 另有租户隔离钩子；viewer 只读查看）。
 *
 * 规则：owner 永远是 admin 等价（requireAdmin 接受 owner，绝不降级既有 admin）。
 */
export const ROLES = ["owner", "admin", "member", "researcher", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export function isValidRole(role: unknown): role is Role {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role);
}

/** owner 与 admin 都是管理员等价。 */
export function isAdminRole(role: unknown): boolean {
  return role === "admin" || role === "owner";
}

/** 仅 owner（最高权限）。 */
export function isOwner(role: unknown): boolean {
  return role === "owner";
}

/** 可写：owner / admin / member。researcher / viewer 只读。 */
export function canWrite(role: unknown): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/** 可审批（授权、关键操作）：仅 owner / admin。 */
export function canApprove(role: unknown): boolean {
  return isAdminRole(role);
}

/**
 * 角色分配规则：只有 owner 可分配 owner 角色；
 * admin 可分配 admin/member/researcher/viewer；
 * 其他角色不可分配任何角色。返回 null 表示允许。
 */
export function roleAssignDenied(
  callerRole: unknown,
  targetRole: unknown
): string | null {
  if (targetRole === "owner") {
    return callerRole === "owner"
      ? null
      : "Only owner may assign the owner role";
  }
  if (callerRole === "owner" || callerRole === "admin") return null;
  return "Admin access required";
}

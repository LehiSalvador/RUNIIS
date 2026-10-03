/**
 * Admin nav definition, kept out of the "use client" AdminShell module so server components (the page
 * guard, the role matrix) can read the values: a value exported from a client module is only a reference
 * on the server. admin-shell.tsx re-exports both names, so existing imports keep working.
 */
export const ADMIN_NAV_ITEMS = [
  { key: "dashboard", href: "/admin", label: "Dashboard" },
  { key: "tareas", href: "/admin/tareas", label: "Tareas" },
  { key: "eventos", href: "/admin/eventos", label: "Eventos" },
  { key: "solicitudes", href: "/admin/solicitudes", label: "Solicitudes" },
  { key: "participantes", href: "/admin/participantes", label: "Participantes" },
  { key: "kits", href: "/admin/kits", label: "Kits" },
  { key: "asistencia", href: "/admin/asistencia", label: "Asistencia" },
  { key: "cierre", href: "/admin/cierre", label: "Cierre" },
  { key: "comunidad", href: "/admin/comunidad", label: "Comunidad" },
  { key: "usuarios", href: "/admin/usuarios", label: "Usuarios" },
  { key: "comunicaciones", href: "/admin/comunicaciones", label: "Comunicaciones" },
  { key: "auditoria", href: "/admin/auditoria", label: "Auditoría" },
  { key: "ajustes", href: "/admin/ajustes", label: "Ajustes" },
] as const;

export type AdminNavKey = (typeof ADMIN_NAV_ITEMS)[number]["key"];

export const ADMIN_NAV_KEYS: readonly AdminNavKey[] = ADMIN_NAV_ITEMS.map((item) => item.key);

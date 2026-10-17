/**
 * Authentication + admin user-management strings.
 * Shared vocabulary (nav, actions, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  login: {
    title: "登录",
    description: "登录后使用 AdLinkLab。",
    email: "邮箱",
    emailPlaceholder: "you@example.com",
    password: "密码",
    submit: "登录",
    submitting: "登录中…",
    required: "请输入邮箱和密码。",
    failed: "登录失败，请重试。",
    networkError: "无法连接到服务器，请稍后重试。",
    noAccount: "还没有账号？",
    goRegister: "去注册",
  },
  register: {
    title: "注册",
    description: "创建你的 AdLinkLab 账号。",
    name: "姓名",
    namePlaceholder: "张三",
    email: "邮箱",
    emailPlaceholder: "you@example.com",
    password: "密码",
    passwordHint: "至少 8 个字符",
    confirmPassword: "确认密码",
    passwordMismatch: "两次输入的密码不一致。",
    submit: "注册",
    submitting: "注册中…",
    required: "请填写所有必填项。",
    failed: "注册失败，请重试。",
    networkError: "无法连接到服务器，请稍后重试。",
    hasAccount: "已有账号？",
    goLogin: "去登录",
    firstUserNote: "第一个注册的用户将成为管理员。",
  },
  nav: {
    users: "用户管理",
    apiKeys: "API Keys 管理",
  },
  userMenu: {
    admin: "管理员",
    user: "用户",
    logout: "退出登录",
  },
  banner: {
    viewingAs: "正在查看其他用户的数据",
    exitView: "退出查看",
  },
  admin: {
    users: {
      title: "用户管理",
      description: "查看所有注册用户。以管理员身份查看某个用户的数据。",
      columns: {
        email: "邮箱",
        name: "姓名",
        role: "角色",
        tenant: "租户",
        created: "注册时间",
      },
      roles: {
        admin: "管理员",
        user: "用户",
      },
      viewData: "查看数据",
      empty: "暂无注册用户。",
      loadError: "加载用户列表失败。",
    },
  },
};

export const en: typeof zh = {
  login: {
    title: "Sign in",
    description: "Sign in to use AdLinkLab.",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    required: "Please enter your email and password.",
    failed: "Sign-in failed. Please try again.",
    networkError: "Cannot reach the server. Please try again later.",
    noAccount: "No account yet?",
    goRegister: "Register",
  },
  register: {
    title: "Register",
    description: "Create your AdLinkLab account.",
    name: "Name",
    namePlaceholder: "Jane",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordHint: "At least 8 characters",
    confirmPassword: "Confirm password",
    passwordMismatch: "The two passwords do not match.",
    submit: "Register",
    submitting: "Registering…",
    required: "Please fill in all required fields.",
    failed: "Registration failed. Please try again.",
    networkError: "Cannot reach the server. Please try again later.",
    hasAccount: "Already have an account?",
    goLogin: "Sign in",
    firstUserNote: "The first registered user becomes admin.",
  },
  nav: {
    users: "Users",
    apiKeys: "API Keys",
  },
  userMenu: {
    admin: "Admin",
    user: "User",
    logout: "Sign out",
  },
  banner: {
    viewingAs: "Viewing another user's data",
    exitView: "Exit view",
  },
  admin: {
    users: {
      title: "User management",
      description: "View all registered users. Inspect a user's data as admin.",
      columns: {
        email: "Email",
        name: "Name",
        role: "Role",
        tenant: "Tenant",
        created: "Registered",
      },
      roles: {
        admin: "Admin",
        user: "User",
      },
      viewData: "View data",
      empty: "No registered users yet.",
      loadError: "Failed to load users.",
    },
  },
};

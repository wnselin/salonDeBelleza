const COMMON_PASSWORDS = new Set([
  'password',
  'passw0rd',
  'qwerty123456',
  'administrator',
  'letmein12345',
  '123456789012'
]);

export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 12) return 'Пароль должен быть не короче 12 символов';
  if (password.length > 200) return 'Пароль слишком длинный';
  if (/\s/.test(password)) return 'Пароль не должен содержать пробелов';

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password)
  ].filter(Boolean).length;

  if (classes < 3) {
    return 'Используйте минимум 3 из 4 групп символов: строчные, заглавные, цифры, спецсимволы';
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Этот пароль слишком распространён';
  }

  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return 'Пароль не должен содержать имя пользователя';
  }

  if (/^(.)\1+$/.test(password)) {
    return 'Пароль слишком простой';
  }

  return null;
}

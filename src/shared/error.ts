// 创建命名错误
export const createNamedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = `DGLAB-${name}`;
  return error;
};

import { createApp } from './app';

const allowedOrigins = (process.env.KURUKURU_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export default createApp({ allowedOrigins });

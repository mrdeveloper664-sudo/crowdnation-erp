process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://nexerp_app:nexerp_app_pw@localhost:5432/nexerp_test?schema=public';
process.env.DIRECT_DATABASE_URL = 'postgresql://nexerp:nexerp_pw@localhost:5432/nexerp_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.JWT_ACCESS_TTL = '15m';
process.env.AUTH_RATE_LIMIT = '10000';

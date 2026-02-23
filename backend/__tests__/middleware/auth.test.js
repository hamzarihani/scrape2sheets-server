const { requireAuth } = require('../../middleware/auth');

// Mock the supabase service
jest.mock('../../services/supabase-service', () => ({
  supabase: {
    auth: {
      getUser: jest.fn()
    },
    from: jest.fn()
  }
}));

// Mock the user cache service
jest.mock('../../services/user-cache-service', () => ({
  getCachedUser: jest.fn(),
  setCachedUser: jest.fn()
}));

// Mock the logger to prevent console output
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const { supabase } = require('../../services/supabase-service');
const { getCachedUser, setCachedUser } = require('../../services/user-cache-service');

describe('Auth Middleware - requireAuth', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    mockReq = {
      headers: {}
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
  });

  describe('Missing Authorization Header', () => {
    it('should return 401 when no Authorization header is present', async () => {
      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized: Missing or invalid authorization header'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      mockReq.headers.authorization = 'Basic sometoken';

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized: Missing or invalid authorization header'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Empty Token', () => {
    it('should return 401 when Bearer token is empty', async () => {
      mockReq.headers.authorization = 'Bearer ';

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized: Missing access token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Token', () => {
    it('should return 401 when Supabase returns an error', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      supabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' }
      });

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized: Invalid or expired token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when no user is found for token', async () => {
      mockReq.headers.authorization = 'Bearer valid-but-no-user';

      supabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized: User not found'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Valid Token', () => {
    it('should call next() and set req.userId when token is valid', async () => {
      const mockAuthUser = {
        id: 'user-123',
        email: 'test@example.com'
      };

      const mockFullUser = {
        id: 'user-123',
        email: 'test@example.com',
        plan: 'free',
        usage: 0
      };

      mockReq.headers.authorization = 'Bearer valid-token';

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockAuthUser },
        error: null
      });

      getCachedUser.mockResolvedValue(mockFullUser);

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockReq.userId).toBe('user-123');
      expect(mockReq.user).toEqual(mockFullUser);
      expect(mockReq.accessToken).toBe('valid-token');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache on cache miss', async () => {
      const mockAuthUser = {
        id: 'user-456',
        email: 'test2@example.com'
      };

      const mockDbUser = {
        id: 'user-456',
        email: 'test2@example.com',
        plan: 'pro',
        usage: 10
      };

      mockReq.headers.authorization = 'Bearer valid-token-2';

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockAuthUser },
        error: null
      });

      getCachedUser.mockResolvedValue(null);
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockDbUser, error: null })
          })
        })
      });

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockReq.userId).toBe('user-456');
      expect(mockReq.user).toEqual(mockDbUser);
      expect(setCachedUser).toHaveBeenCalledWith('user-456', mockDbUser);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 404 when user profile not found in DB', async () => {
      const mockAuthUser = {
        id: 'user-789',
        email: 'ghost@example.com'
      };

      mockReq.headers.authorization = 'Bearer valid-token-3';

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockAuthUser },
        error: null
      });

      getCachedUser.mockResolvedValue(null);
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } })
          })
        })
      });

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'User profile not found. Please try signing in again.'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when an unexpected error occurs', async () => {
      mockReq.headers.authorization = 'Bearer some-token';

      supabase.auth.getUser.mockRejectedValue(new Error('Database connection failed'));

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error during authentication'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

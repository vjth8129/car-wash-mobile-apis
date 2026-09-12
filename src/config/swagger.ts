import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Car Wash Management API',
      version: '1.0.0',
      description:
        'Multi-tenant Car Wash Management System REST API. All endpoints are versioned under /api/v1. ' +
        'Authenticate via POST /api/v1/auth/login, then send `Authorization: Bearer <accessToken>` on ' +
        'subsequent requests. Tenant scoping (carWashId) is always derived server-side from the ' +
        'authenticated user and is never accepted from client input for tenant-scoped resources.',
      contact: { name: 'Car Wash API' },
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api/v1', description: 'Current server' }],
    tags: [
      { name: 'Authentication', description: 'Login, tokens, and password reset' },
      { name: 'App', description: 'Dynamic menu and app configuration for the mobile/web client' },
      { name: 'Car Washes', description: 'Platform-level car wash (tenant) management' },
      { name: 'Users', description: 'User management within a car wash' },
      { name: 'Roles', description: 'Role management and permission assignment' },
      { name: 'Permissions', description: 'Available system permissions' },
      { name: 'Services', description: 'Car wash service catalog' },
      { name: 'Customers', description: 'Customer management' },
      { name: 'Vehicles', description: 'Customer vehicles' },
      { name: 'Bookings', description: 'Service bookings/appointments' },
      { name: 'Orders', description: 'Car wash job/order workflow' },
      { name: 'Reports', description: 'Operational and platform reports' },
      { name: 'Health', description: 'Service health checks' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Invalid request' },
                details: { type: 'object', nullable: true },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 5 },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Missing or invalid authentication token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        ForbiddenError: {
          description: 'Authenticated but not permitted to perform this action',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        ValidationError: {
          description: 'Request failed validation',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [path.join(__dirname, '../routes/*.ts'), path.join(__dirname, '../routes/*.js')],
};

export const swaggerSpec = swaggerJsdoc(options);

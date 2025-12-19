import 'reflect-metadata';
import { container } from 'tsyringe';
import logger from './utils/logger';
import { AuditService } from './services/AuditService';
import { AdminService } from './services/AdminService';
import { UserService } from './services/UserService';

// Register logger
container.register('Logger', {
  useValue: logger,
});

// Register services
container.register(AuditService, {
  useClass: AuditService,
});

container.register(AdminService, {
  useClass: AdminService,
});

container.register(UserService, {
  useClass: UserService,
});

export { container };

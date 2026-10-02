import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Permission } from '@paybridge/shared';
import { Actor } from './actor';

export const IS_PUBLIC = 'pb:public';
export const AUTH_ONLY = 'pb:authOnly';
export const REQUIRED_PERMISSIONS = 'pb:permissions';

/** No authentication. Use sparingly: login, register, webhooks (signature-authenticated), health. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Authentication only, no specific permission (e.g. /auth/me, creating one's first company). */
export const Authenticated = () => SetMetadata(AUTH_ONLY, true);
/** All listed permissions are required. A route with none of these three decorators is denied. */
export const Permissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  return context.switchToHttp().getRequest().actor;
});

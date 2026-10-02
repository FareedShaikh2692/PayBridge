import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Actor } from '../../common/actor';
import { Authenticated, CurrentActor, Public } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { AppConfig, CONFIG } from '../../config';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, IssuedTokens } from './auth.service';

const COOKIE = 'pb_refresh';
const COOKIE_PATH = '/api/v1/auth';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto);
    this.setCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  /** Cookie-authenticated, so it is protected by SameSite=Strict plus an Origin check (docs/SECURITY.md §7). */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    try {
      const tokens = await this.auth.refresh(req.cookies?.[COOKIE]);
      this.setCookie(res, tokens);
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
    } catch (err) {
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    return { loggedOut: true };
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }

  private assertOrigin(req: Request): void {
    const origin = req.header('origin');
    if (origin && !this.config.corsOrigins.includes(origin)) throw new DomainError('FORBIDDEN', 'Origin not allowed.');
  }

  private setCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }
}

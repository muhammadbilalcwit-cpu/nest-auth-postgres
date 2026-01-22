import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ApiResponse } from '../common/utils/api-response';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';

interface JwtPayload {
  sub: number;
  email?: string;
  iat?: number;
  exp?: number;
}

/**
 * Controller responsible for authentication and session lifecycle.
 *
 * Handles login, token refresh and logout using HTTP-only cookies
 * for `accessToken` and `refreshToken`.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  // @Post('signup')
  // async signup(@Body() body: SignupDto) {
  //   const data = await this.authService.signup(body);
  //   return ApiResponse.success('User registered successfully', 201, data);
  // }

  /**
   * Authenticate user with credentials and issue access/refresh tokens.
   *
   * Sets `accessToken` (short-lived) and `refreshToken` (long-lived)
   * as secure HTTP-only cookies.
   *
   * @param body - Login credentials (email/password).
   * @param req - Incoming request, used to read IP and user agent.
   * @param res - Response with `passthrough` to set cookies.
   * @returns Standard API success response without body payload.
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];

    const { accessToken, refreshToken } = await this.authService.login(
      body,
      ipAddress,
      userAgent,
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    return ApiResponse.success('Logged in successfully', 200, null);
  }

  /**
   * Refresh the access token using a valid refresh token cookie.
   *
   * Validates the refresh token, checks the backing session in the database
   * and issues a new short-lived `accessToken` cookie.
   *
   * @param req - Incoming request with `refreshToken` cookie.
   * @param res - Response used to set the new `accessToken` cookie.
   * @returns Standard API success response when token is refreshed.
   * @throws UnauthorizedException if the refresh token is missing or invalid.
   */
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken as string | undefined;
    if (!refreshToken) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken);
    } catch {
      // JWT expired or invalid - clear cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');
      throw new UnauthorizedException('Invalid refresh token');
    }

    try {
      // This will check if session is valid in database
      const { accessToken } = await this.authService.refresh(
        payload.sub,
        refreshToken,
      );

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000,
      });

      return ApiResponse.success('Token refreshed', 200);
    } catch {
      // Session expired in database - clear cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');
      throw new UnauthorizedException('Session expired');
    }
  }

  /**
   * Log out the current user and invalidate their session.
   *
   * Clears both `accessToken` and `refreshToken` cookies and
   * marks the corresponding session as invalid if possible.
   *
   * @param req - Incoming request used to read the refresh token cookie.
   * @param res - Response used to clear authentication cookies.
   * @returns Standard API success response when logout completes.
   */
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken as string | undefined;

    // Invalidate session in database if token exists
    if (refreshToken) {
      try {
        const payload = this.jwtService.verify<JwtPayload>(refreshToken);
        await this.authService.logout(payload.sub, refreshToken);
      } catch {
        // Token invalid, just clear cookies
      }
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return ApiResponse.success('Logged out successfully', 200);
  }
}

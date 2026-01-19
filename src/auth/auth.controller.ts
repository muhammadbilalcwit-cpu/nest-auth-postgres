import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { ApiResponse } from '../common/utils/api-response';
import type { Request, Response } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException();

    let payload;
    try {
      payload = this.jwtService.verify(refreshToken);
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

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;

    // Invalidate session in database if token exists
    if (refreshToken) {
      try {
        const payload = this.jwtService.verify(refreshToken);
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

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RolesService } from '../roles/roles.service';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private rolesService: RolesService,
    private sessionsService: SessionsService,
  ) {}

  async signup(signupDto: SignupDto) {
    const hashed = await bcrypt.hash(signupDto.password, 10);

    const existingUser = await this.usersService.findByEmail(signupDto.email);
    if (existingUser) {
      throw new UnauthorizedException('Email already in use');
    }

    // default role slug for public signups
    const defaultRole = await this.rolesService.findBySlug('user');

    return this.usersService.create({
      email: signupDto.email,
      password: hashed,
      firstname: signupDto.firstname,
      lastname: signupDto.lastname,
      age: signupDto.age,
      roleSlug: defaultRole?.slug,
    });
  }

  private async generateTokens(user: any) {
    const roles = [
      user.role?.slug,
      ...(user.userRoles || []).map((r) => r.role.slug),
    ]
      .filter(Boolean)
      .map((r) => r.toLowerCase());

    const payload = {
      sub: user.id,
      email: user.email,
      companyId: user.company?.id ?? null,
      departmentId: user.department?.id ?? null,
      roles,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m', // FOR TESTING: 1 minute (change back to '15m' for production)
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      { expiresIn: '1d' },
    );

    return { accessToken, refreshToken };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) throw new UnauthorizedException();

    const isMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!isMatch) throw new UnauthorizedException();

    const tokens = await this.generateTokens(user);

    // Create session in database
    await this.sessionsService.createSession(
      user.id,
      tokens.refreshToken,
      ipAddress,
      userAgent,
    );

    return tokens;
  }

  async refresh(userId: number, refreshToken: string) {
    // Validate session exists and is valid
    const session = await this.sessionsService.validateSession(
      userId,
      refreshToken,
    );
    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    const user = await this.usersService.findOne(userId);
    if (!user) throw new UnauthorizedException();

    return this.generateTokens(user);
  }

  async logout(userId: number, refreshToken: string) {
    await this.sessionsService.invalidateSession(userId, refreshToken);
  }
}

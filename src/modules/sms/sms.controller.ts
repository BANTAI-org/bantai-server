import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { OtpDispatchResult, SmsService } from './sms.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

const bodyPipe = new ValidationPipe({ whitelist: true, transform: true });

@Controller('sms/otp')
@ApiTags('SMS OTP')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a one-time password by SMS' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({ status: 202, description: 'OTP dispatch accepted' })
  @ApiResponse({ status: 400, description: 'Invalid mobile number' })
  @HttpCode(HttpStatus.ACCEPTED)
  send(@Body(bodyPipe) dto: SendOtpDto): Promise<OtpDispatchResult> {
    return this.smsService.sendOtp(dto.m_number);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify a one-time password' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'OTP verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @HttpCode(HttpStatus.OK)
  async verify(@Body(bodyPipe) dto: VerifyOtpDto): Promise<{ verified: true }> {
    await this.smsService.verifyOtp(dto.m_number, dto.otp_code);
    return { verified: true };
  }
}

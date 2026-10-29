import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReassignBranchDTO {
  @ApiProperty({
    description: 'Target command center UUID to reassign the responder to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID('4')
  @IsNotEmpty()
  targetCommandCenterId!: string;
}
import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST /incidents/:incidentId/assign.
 *
 * `assignedById` is NOT a client field — it comes from the auth token.
 * The DB trigger handle_center_assignment audits with that id and
 * inserts the inbox notification for the responder.
 */
export class AssignResponderDto {
  @ApiProperty({
    description: 'UUID of the responder to assign',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  responder_id!: string;
}

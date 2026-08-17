import { IsUUID } from 'class-validator'

export class ReportRoomDto {
  @IsUUID()
  targetId!: string
}

import { IsUUID } from 'class-validator'

export class SendFriendRequestDto {
  @IsUUID()
  toId!: string
}

import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class BanMemberDto {
  @IsUUID()
  targetId!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string
}

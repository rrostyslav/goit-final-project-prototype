import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string

  @IsOptional()
  @IsUrl()
  avatarUrl?: string
}

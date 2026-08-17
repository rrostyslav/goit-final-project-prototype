import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class GuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  nickname!: string
}

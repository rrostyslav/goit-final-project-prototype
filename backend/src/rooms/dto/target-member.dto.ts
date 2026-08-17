import { IsUUID } from 'class-validator'

/** Shared body shape for host actions that target one other member —
 * transferHost and kick. */
export class TargetMemberDto {
  @IsUUID()
  targetId!: string
}

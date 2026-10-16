import { Role } from '../../../common/enums/role-enum';
import { AgencyTypeEnum } from '../../responders/enums/agency-type.enum';
import { AvailabilityStatusEnum } from '../../responders/enums/availability-status.enum';
import { PoliceRank } from '../../responders/enums/police-rank.enum';

export interface ResponderTableRow {
  id: string;
  f_name: string;
  l_name: string;
  m_name: string | null;
  role: Role;
  email: string;
  rank: PoliceRank | null;
  agency: AgencyTypeEnum;
  availability: AvailabilityStatusEnum;
}

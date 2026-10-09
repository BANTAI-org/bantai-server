import { Role } from '../../../common/enums/role-enum';
import { AgencyTypeEnum } from '../../responders/enums/agency-type.enum';
import { AvailabilityStatusEnum } from '../../responders/enums/availability-status.enum';

export interface ResponderTableRow {
  id: string;
  f_name: string;
  l_name: string;
  m_name: string | null;
  role: Role;
  agency: AgencyTypeEnum;
  availability: AvailabilityStatusEnum;
}

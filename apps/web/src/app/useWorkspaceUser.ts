import { useOutletContext } from 'react-router';
import type { User } from '../lib/api';

export function useWorkspaceUser() { return useOutletContext<User>(); }

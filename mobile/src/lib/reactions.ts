import { Check, Eye, Heart, Laugh, Lightbulb, PartyPopper, ThumbsUp, type LucideIcon } from 'lucide-react-native';

export type ReactionOption = { value: string; label: string; Icon: LucideIcon };

export const REACTION_OPTIONS: ReactionOption[] = [
  { value: '👍', label: 'Thumbs up', Icon: ThumbsUp },
  { value: '❤️', label: 'Love', Icon: Heart },
  { value: '✅', label: 'Complete', Icon: Check },
  { value: '👀', label: 'Looking into it', Icon: Eye },
  { value: '💡', label: 'Insightful', Icon: Lightbulb },
  { value: '🙌', label: 'Celebrate', Icon: PartyPopper },
  { value: '😂', label: 'Funny', Icon: Laugh },
];

export function reactionOption(value: string) {
  return REACTION_OPTIONS.find((option) => option.value === value) || null;
}

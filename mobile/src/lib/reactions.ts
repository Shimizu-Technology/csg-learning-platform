import { Check, Heart, Laugh, Lightbulb, ThumbsUp, type LucideIcon } from 'lucide-react-native';

export type ReactionOption = { value: string; label: string; Icon: LucideIcon };

export const REACTION_OPTIONS: ReactionOption[] = [
  { value: '👍', label: 'Thumbs up', Icon: ThumbsUp },
  { value: '❤️', label: 'Love', Icon: Heart },
  { value: '✅', label: 'Complete', Icon: Check },
  { value: '😂', label: 'Funny', Icon: Laugh },
  { value: '💡', label: 'Insightful', Icon: Lightbulb },
];

export function reactionOption(value: string) {
  return REACTION_OPTIONS.find((option) => option.value === value) || null;
}

import { useState } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { haptic as triggerHaptic, type HapticMoment } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export type PressableScaleProps = PressableProps & { haptic?: HapticMoment };
export function PressableScale({ style, onPressIn, onPressOut, onPress, disabled, haptic, ...props }: PressableScaleProps) {
  const pressed = useSharedValue(0);
  const [pressedState, setPressedState] = useState(false);
  const reduced = useReducedMotion();
  const hasStyleCallback = typeof style === 'function';
  const animated = useAnimatedStyle(() => ({
    opacity: disabled ? 0.5 : 1 - pressed.get() * 0.14,
    transform: [{ scale: reduced ? 1 : 1 - pressed.get() * 0.03 }],
  }), [disabled, reduced]);
  const pressState = { pressed: pressedState, hovered: false };
  const pressInAnim = () => {
    pressed.set(withTiming(1, { duration: 100, easing: Easing.bezier(.23, 1, .32, 1), reduceMotion: ReduceMotion.System }));
  };
  const pressOutAnim = () => {
    pressed.set(withSpring(0, { damping: 18, stiffness: 320, mass: 0.6, reduceMotion: ReduceMotion.System }));
  };
  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(e) => {
        if (hasStyleCallback) setPressedState(true);
        pressInAnim();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (hasStyleCallback) setPressedState(false);
        pressOutAnim();
        onPressOut?.(e);
      }}
      onPress={onPress ? (e) => {
        if (haptic) triggerHaptic(haptic);
        onPress(e);
      } : undefined}
      style={[hasStyleCallback ? style(pressState) : style, animated]}
    />
  );
}

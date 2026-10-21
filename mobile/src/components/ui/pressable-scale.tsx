import { useState } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function PressableScale({ style, onPressIn, onPressOut, disabled, ...props }: PressableProps) {
  const pressed = useSharedValue(0);
  const [pressedState, setPressedState] = useState(false);
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ opacity: disabled ? 0.5 : 1 - pressed.get() * 0.16,
    transform: [{ scale: reduced ? 1 : 1 - pressed.get() * 0.03 }] }), [disabled, reduced]);
  const pressState = { pressed: pressedState, hovered: false };
  const animate = (value: number) => { pressed.set(withTiming(value, { duration: 120, easing: Easing.bezier(.23, 1, .32, 1), reduceMotion: ReduceMotion.System })); };
  return <AnimatedPressable {...props} disabled={disabled} onPressIn={(e) => { setPressedState(true); animate(1); onPressIn?.(e); }} onPressOut={(e) => { setPressedState(false); animate(0); onPressOut?.(e); }} style={[typeof style === 'function' ? style(pressState) : style, animated]} />;
}

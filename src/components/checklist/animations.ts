import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface SpringConfig {
  damping: number;
  stiffness: number;
}

function springTo(
  value: Animated.Value,
  toValue: number,
  config: SpringConfig,
): Animated.CompositeAnimation {
  return Animated.spring(value, {
    toValue,
    damping: config.damping,
    stiffness: config.stiffness,
    mass: 1,
    useNativeDriver: true,
  });
}

export function useStaggeredEntrance(
  itemCount: number,
  expanded: boolean,
  spring: SpringConfig,
) {
  const anims = useRef<Animated.Value[]>([]);

  while (anims.current.length < itemCount) {
    anims.current.push(new Animated.Value(0));
  }

  useEffect(() => {
    if (expanded) {
      const staggered = anims.current.slice(0, itemCount).map((anim, i) =>
        Animated.sequence([
          Animated.delay(i * 50),
          springTo(anim, 1, spring),
        ]),
      );
      Animated.parallel(staggered).start();
    } else {
      Animated.parallel(
        anims.current.slice(0, itemCount).map((anim) =>
          Animated.timing(anim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ),
      ).start();
    }
  }, [expanded, itemCount, spring]);

  return anims.current;
}

export function useCheckmark(completed: boolean, spring: SpringConfig) {
  const fillProgress = useRef(new Animated.Value(completed ? 1 : 0)).current;
  const checkScale = useRef(new Animated.Value(completed ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (completed) {
      Animated.sequence([
        springTo(fillProgress, 1, { ...spring, stiffness: spring.stiffness * 1.2 }),
        Animated.sequence([
          springTo(checkScale, 1.3, { damping: 8, stiffness: 300 }),
          springTo(checkScale, 1, { damping: 12, stiffness: 200 }),
        ]),
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.02,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else {
      fillProgress.setValue(0);
      checkScale.setValue(0);
      pulse.setValue(1);
    }
  }, [completed, fillProgress, checkScale, pulse, spring]);

  return { fillProgress, checkScale, pulse };
}

export function useStrikethrough(completed: boolean) {
  const width = useRef(new Animated.Value(completed ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: completed ? 1 : 0,
      duration: completed ? 400 : 200,
      easing: completed ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [completed, width]);

  return width;
}

export function useProgressAnimation(progress: number) {
  const animatedProgress = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.spring(animatedProgress, {
      toValue: progress,
      damping: 20,
      stiffness: 120,
      useNativeDriver: false,
    }).start();
  }, [progress, animatedProgress]);

  return animatedProgress;
}

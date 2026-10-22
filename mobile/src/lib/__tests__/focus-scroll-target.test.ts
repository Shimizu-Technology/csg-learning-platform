import type { ScrollView, View } from 'react-native';
import { focusScrollTarget } from '../focus-scroll-target';

it('measures against the inner component, retries after layout failure, and completes only on success', () => {
  const frames: FrameRequestCallback[] = [];
  const frame = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const inner = {};
  const scrollTo = jest.fn();
  const scroll = { getInnerViewRef: () => inner, getInnerViewNode: () => 123, scrollTo } as unknown as ScrollView;
  const complete = jest.fn();
  const measureLayout = jest.fn().mockImplementationOnce((_ref, _success, fail) => fail()).mockImplementationOnce((ref, success) => { expect(ref).toBe(inner); success(0, 400); });
  focusScrollTarget({ measureLayout } as Pick<View, 'measureLayout'>, { current: scroll }, { current: inner as View }, complete);
  frames.shift()!(0);
  expect(complete).not.toHaveBeenCalled();
  expect(scrollTo).not.toHaveBeenCalled();
  frames.shift()!(0);
  expect(scrollTo).toHaveBeenCalledWith({ y: 384, animated: false });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(measureLayout).toHaveBeenCalledTimes(2);
  frame.mockRestore();
});
it('leaves an unmeasured target pending and bounds retries', () => {
  const frames: FrameRequestCallback[] = [];
  const frame = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const complete = jest.fn();
  const measureLayout = jest.fn((_ref, _success, fail) => fail());
  const inner = {};
  const scroll = { scrollTo: jest.fn() } as unknown as ScrollView;
  focusScrollTarget({ measureLayout } as Pick<View, 'measureLayout'>, { current: scroll }, { current: inner as View }, complete);
  frames.shift()!(0); frames.shift()!(0);
  expect(complete).not.toHaveBeenCalled();
  expect(frames).toHaveLength(0);
  frame.mockRestore();
});

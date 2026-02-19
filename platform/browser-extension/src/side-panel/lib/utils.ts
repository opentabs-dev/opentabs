import classNames from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ClassNameValue } from 'tailwind-merge';

export const cn = (...classes: ClassNameValue[]) => twMerge(classNames(classes));

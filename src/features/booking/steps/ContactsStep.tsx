import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { contactsSchemaFor, fieldErrors, type Contacts } from '@/lib/validation';
import { useStudio } from '@/features/studio/StudioContext';
import { placeWords } from '@/features/studio/words';
import { readDraft, writeDraft } from '../draft';

// Props the input accepts at runtime but Astryx types omit.
const telInput = { inputMode: 'tel', enterKeyHint: 'next' } as Record<string, string>;
const nextKey = { enterKeyHint: 'next' } as Record<string, string>;

export function ContactsStep({ slug, onDone }: { slug: string; onDone: () => void }) {
  const hasCar = placeWords(useStudio().kind).hasCar;
  const contactsSchema = contactsSchemaFor(hasCar);
  const [values, setValues] = useState<Contacts>(() => readDraft(slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const set = (k: keyof Contacts) => (v: string) => {
    const next = { ...values, [k]: v };
    setValues(next);
    writeDraft(slug, next);
    if (touched) setErrors(fieldErrors(contactsSchema.safeParse(next)));
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    const res = contactsSchema.safeParse(values);
    const errs = fieldErrors(res);
    setErrors(errs);
    if (!res.success) {
      const first = Object.keys(errs)[0];
      document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    writeDraft(slug, { ...values, phone: res.data.phone });
    onDone();
  };

  const status = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);

  return (
    <form onSubmit={submit} noValidate>
      <VStack gap={4}>
        <TextInput label="Имя" htmlName="name" value={values.name} onChange={set('name')} autoComplete="name" isRequired status={status('name')} statusVariant="detached" width="100%" {...nextKey} />
        <TextInput
          label="Телефон"
          htmlName="phone"
          value={values.phone}
          onChange={set('phone')}
          autoComplete="tel"
          placeholder="+7 900 000-00-00"
          isRequired
          status={status('phone')}
          statusVariant="detached"
          width="100%"
          {...telInput}
        />
        {hasCar ? <TextInput label="Автомобиль" htmlName="car" value={values.car} onChange={set('car')} placeholder="Марка, модель, цвет" isRequired status={status('car')} statusVariant="detached" width="100%" {...nextKey} /> : null}
        <TextArea label="Комментарий" htmlName="comment" value={values.comment} onChange={set('comment')} isOptional rows={2} maxLength={500} status={status('comment')} statusVariant="detached" width="100%" />
        <Button type="submit" variant="primary" size="lg" label="Дальше" width="100%" />
      </VStack>
    </form>
  );
}

describe('student simulator walkthrough data', () => {
  const originalRole = process.env.EXPO_PUBLIC_DEMO_ROLE;

  afterEach(() => {
    if (originalRole === undefined) delete process.env.EXPO_PUBLIC_DEMO_ROLE;
    else process.env.EXPO_PUBLIC_DEMO_ROLE = originalRole;
    jest.resetModules();
  });

  it('uses one coherent student identity across account, inbox, and member discovery', () => {
    process.env.EXPO_PUBLIC_DEMO_ROLE = 'student';
    jest.resetModules();
    let data!: typeof import('../demo-data');
    jest.isolateModules(() => { data = jest.requireActual('../demo-data'); });

    expect(data.demoUser).toMatchObject({ id: 23, full_name: 'Noah Cruz', role: 'student', is_staff: false });
    expect(data.demoDms[0].title).toBe('Leon Shimizu');
    expect(data.demoDms[0].users.map((user) => user.id)).toEqual(expect.arrayContaining([data.demoUser.id, data.demoAdminUser.id]));
    expect(data.demoPeople.filter((user) => user.id === data.demoUser.id)).toHaveLength(1);
    expect(data.demoNotifications[0]).toMatchObject({ path: '/lessons/100', notifiable: { type: 'Submission', id: 8 } });
    expect(data.demoNotifications[1]).toMatchObject({ path: '/messages/dm/31', notifiable: { type: 'Message', id: data.demoDms[0].latest_message?.id } });
    expect(data.demoMessages['dm:32'].at(-1)).toMatchObject({
      id: data.demoDms[1].latest_message?.id,
      body: data.demoDms[1].latest_message?.body,
      author: { full_name: data.demoDms[1].latest_message?.author_name },
    });
  });

  it('opens the lesson that matches each student dashboard action', () => {
    process.env.EXPO_PUBLIC_DEMO_ROLE = 'student';
    jest.resetModules();
    let learning!: typeof import('../demo-learning');
    jest.isolateModules(() => { learning = jest.requireActual('../demo-learning'); });
    const { demoDashboard, demoLessonFor } = learning;

    expect(demoLessonFor(demoDashboard.continue_lesson!.id).title).toBe(demoDashboard.continue_lesson!.title);
    expect(demoLessonFor(demoDashboard.recently_graded![0].lesson_id).title).toBe(demoDashboard.recently_graded![0].lesson_title);
    expect(demoLessonFor(demoDashboard.action_items![0].lesson_id).title).toBe(demoDashboard.action_items![0].lesson_title);
    expect(demoLessonFor(100).content_blocks[1].submissions?.[0]).toMatchObject({ grade: 'A', feedback: 'Clear structure and thoughtful landmarks.' });
    expect(demoLessonFor(102).content_blocks[1].submissions?.[0]).toMatchObject({ grade: 'R', feedback: 'Add an explicit label for every field.' });
    expect(demoLessonFor(103).title).toBe('JavaScript interactions');
    expect(demoLessonFor(104)).toMatchObject({ title: 'Container query stretch', lesson_type: 'exercise' });
    expect(() => demoLessonFor(999)).toThrow('Sample lesson 999 is not available.');
  });
});

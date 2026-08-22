---
icon: fas fa-gamepad
order: 2
---

Bring your own ROM — everything runs entirely in your browser, and nothing you load is ever uploaded anywhere.

<div class="tools-list emulator-list mt-4">
  {% assign emulators = site.data.emulators %}
  {% if emulators and emulators.size > 0 %}
    {% for emulator in emulators %}
      <article class="card-wrapper card mb-3">
        <a href="{{ emulator.url | relative_url }}" class="post-preview row g-0">
          <div class="col-12">
            <div class="card-body">
              <h2 class="card-title my-1">{{ emulator.name }}</h2>
              <p class="card-text text-muted mb-0">{{ emulator.description }}</p>
            </div>
          </div>
        </a>
      </article>
    {% endfor %}
  {% else %}
    <p class="text-muted">Emulators are coming soon.</p>
  {% endif %}
</div>

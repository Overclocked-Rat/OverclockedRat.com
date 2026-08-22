---
icon: fas fa-gamepad
order: 2
---

Bring your own ROM — everything runs entirely in your browser, and nothing you load is ever uploaded anywhere.

<div class="tile-grid mt-4">
  {% assign emulators = site.data.emulators %}
  {% if emulators and emulators.size > 0 %}
    {% for emulator in emulators %}
      <a href="{{ emulator.url | relative_url }}" class="card-wrapper card tile">
        <i class="{{ emulator.icon | default: 'fas fa-gamepad' }} tile-icon" aria-hidden="true"></i>
        <span class="tile-name">{{ emulator.name }}</span>
        {% assign blurb = emulator.tagline | default: emulator.description %}
        {% if blurb %}
          <span class="tile-tagline">{{ blurb }}</span>
        {% endif %}
      </a>
    {% endfor %}
  {% else %}
    <p class="text-muted tile-grid-empty">Emulators are coming soon.</p>
  {% endif %}
</div>

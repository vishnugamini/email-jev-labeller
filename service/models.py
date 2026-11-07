from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .policy import DEFAULT_DESCRIPTIONS

Category = str

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Message(Model):
    sender: str = Field(default='', max_length=500)
    recipients: str = Field(default='', max_length=2000)
    text: str = Field(default='', max_length=100000)
    outgoing: bool = False

class Observation(Model):
    id: str = Field(min_length=1, max_length=200)
    account: str = Field(min_length=1, max_length=320)
    conversation: str = Field(min_length=1, max_length=300)
    revision: str = Field(min_length=1, max_length=500)
    reliable: bool = False
    session: str = Field(min_length=1, max_length=100)
    sender: str = Field(default='', max_length=500)
    sender_name: str = Field(default='', max_length=500)
    subject: str = Field(default='', max_length=2000)
    preview: str = Field(default='', max_length=5000)
    metadata: list[str] = Field(default_factory=list, max_length=15)
    messages: list[Message] = Field(default_factory=list, max_length=100)
    evidence: Literal['preview', 'body'] = 'preview'
    mailbox: Literal['inbox', 'spam', 'trash', 'unknown'] = 'unknown'

class SenderRule(Model):
    kind: Literal['address', 'domain']
    value: str = Field(min_length=1, max_length=320)
    category: Category

class CategoryDescriptions(Model):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    important: str = Field(default=DEFAULT_DESCRIPTIONS['important'], min_length=1, max_length=2000)
    routine: str = Field(default=DEFAULT_DESCRIPTIONS['routine'], min_length=1, max_length=2000)
    spam: str = Field(default=DEFAULT_DESCRIPTIONS['spam'], min_length=1, max_length=2000)

class CustomLabel(Model):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    id: str = Field(pattern=r'^custom_[a-z0-9_]{1,60}$')
    name: str = Field(min_length=1, max_length=32)
    description: str = Field(min_length=1, max_length=2000)

class Preferences(Model):
    priorities: str = Field(default='', max_length=4000)
    category_descriptions: CategoryDescriptions = Field(default_factory=CategoryDescriptions)
    rules: list[SenderRule] = Field(default_factory=list, max_length=100)
    batch_size: Literal[1, 4, 8] = 1
    custom_labels: list[CustomLabel] = Field(default_factory=list, max_length=12)

    def criteria(self):
        return self.category_descriptions.model_dump() | {label.id: f'{label.name}: {label.description}' for label in self.custom_labels}

    @model_validator(mode='after')
    def validate_labels(self):
        ids = [label.id for label in self.custom_labels]
        names = ['important', 'routine', 'spam'] + [label.name.casefold() for label in self.custom_labels]
        if len(ids) != len(set(ids)) or len(names) != len(set(names)):
            raise ValueError('Label names and IDs must be unique.')
        if any(rule.category not in self.criteria() for rule in self.rules):
            raise ValueError('Sender rule refers to an unknown label.')
        return self

class ClassifyRequest(Model):
    emails: list[Observation] = Field(min_length=1, max_length=50)

class OverrideRequest(Model):
    email: Observation
    category: Category

class ResetRequest(Model):
    email: Observation
